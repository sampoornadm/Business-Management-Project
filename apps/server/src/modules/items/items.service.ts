import type {
  CategoryLeafDto,
  ItemDetailDto,
  ItemListEntryDto,
  ItemSortField,
  PaginatedResult,
} from "@bmp/types";

import { env } from "../../config/env.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";
import { embed, generateJson } from "../../infra/llm/ollama.client.js";
import { logger } from "../../shared/logger/logger.js";
import type { AuditService } from "../audit/audit.service.js";
import type { CategoriesService } from "../categories/categories.service.js";
import type { RfqService } from "../rfq/rfq.service.js";

import {
  buildClassifyPrompt,
  type ClassificationResult,
  collapseWhitespace,
  deriveCanonicalName,
  parseClassification,
  pickConfirmedMatch,
} from "./items.helpers.js";
import { aggregateQuotes, sortItemEntries, toItemDetailDto, toItemListEntryDto } from "./items.mapper.js";
import type {
  IItemsRepository,
  ItemForClassify,
  ItemRow,
} from "./items.repository.js";

/** Cap on quote rows shown on the detail page — an item with more history than this is rare. */
const DETAIL_ENTRY_LIMIT = 200;
/** How many already-classified items ground the classifier prompt. */
const CLASSIFY_EXAMPLE_LIMIT = 20;

export interface ItemListFilters {
  businessId: string;
  search?: string;
  status?: "classified" | "unclassified" | "unconfirmed";
  sortBy?: ItemSortField;
  sortDir?: "asc" | "desc";
}

export class ItemsService {
  constructor(
    private readonly itemsRepository: IItemsRepository,
    private readonly rfqService: RfqService,
    private readonly categoriesService: CategoriesService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Resolve any RfqItems in this business that don't yet point at an Item. Converge-on-read
   * (mirrors rates' embedPendingRates): no separate backfill script, and RfqItems created
   * before this feature or by any other path get picked up the next time items are listed.
   * Identity is an EXACT canonical-name match, never fuzzy — see items.helpers.
   */
  private async backfill(businessId: string): Promise<void> {
    const unlinked = await this.itemsRepository.findUnlinkedRfqItems(businessId);
    if (unlinked.length === 0) return;

    const boqIds = [...new Set(unlinked.map((u) => u.boqItemId).filter((id): id is string => Boolean(id)))];
    const boqNames = new Map((await this.itemsRepository.findBoqNames(boqIds)).map((b) => [b.id, b]));

    // Group unlinked lines by canonical name so each distinct item is created once.
    const groups = new Map<string, { unit: string | null; rfqItemIds: string[] }>();
    for (const line of unlinked) {
      const boq = line.boqItemId ? boqNames.get(line.boqItemId) : undefined;
      const canonicalName = deriveCanonicalName(boq?.normalizedName ?? null, line.description);
      const group = groups.get(canonicalName);
      const unit = line.unit ?? boq?.unit ?? null;
      if (group) {
        group.rfqItemIds.push(line.id);
        group.unit ??= unit;
      } else {
        groups.set(canonicalName, { unit, rfqItemIds: [line.id] });
      }
    }

    for (const [canonicalName, group] of groups) {
      const item = await this.itemsRepository.findOrCreateItem(businessId, canonicalName, group.unit);
      await this.itemsRepository.linkRfqItems(item.id, group.rfqItemIds);
    }
    logger.info({ businessId, items: groups.size }, "Resolved items from RFQ lines");
  }

  async listItems(
    pagination: PaginationParams,
    filters: ItemListFilters,
  ): Promise<PaginatedResult<ItemListEntryDto>> {
    await this.backfill(filters.businessId);

    const items = await this.itemsRepository.findItems(filters.businessId, filters.search, filters.status);
    const quoteRows = await this.itemsRepository.findQuoteRowsForItems(items.map((i) => i.id));
    const aggByItem = aggregateQuotes(quoteRows);
    const pathMap = await this.categoriesService.getPathMap();

    // ponytail: aggregate + sort + paginate in memory so every column (incl. rate range,
    // quote count) is sortable. Bounded by a business's item count — fine at this scale;
    // add DB-side aggregation if a catalog ever grows past tens of thousands of items.
    const entries = items.map((item) =>
      toItemListEntryDto(
        item,
        aggByItem.get(item.id),
        item.categoryId ? pathMap.get(item.categoryId) ?? null : null,
      ),
    );
    const sorted = sortItemEntries(entries, filters.sortBy, filters.sortDir ?? "asc");
    const start = (pagination.page - 1) * pagination.pageSize;
    return buildPaginatedResult(sorted.slice(start, start + pagination.pageSize), sorted.length, pagination);
  }

  async getItemDetail(id: string, businessId: string): Promise<ItemDetailDto> {
    const item = await this.getItemOrThrow(id, businessId);
    const priceResult = await this.rfqService.listItemPrices(
      { page: 1, pageSize: DETAIL_ENTRY_LIMIT },
      { businessId, itemId: id },
    );
    const pathMap = await this.categoriesService.getPathMap();
    return toItemDetailDto(
      item,
      priceResult.items,
      item.categoryId ? pathMap.get(item.categoryId) ?? null : null,
    );
  }

  /** Confirm or override an item's category. A human touch clears the AI confidence. */
  async setCategory(
    id: string,
    businessId: string,
    input: { categoryId: string | null; confirmed?: boolean },
  ): Promise<ItemDetailDto> {
    await this.getItemOrThrow(id, businessId);
    if (input.categoryId) {
      const leaves = await this.categoriesService.getLeaves();
      if (!leaves.some((l) => l.id === input.categoryId)) {
        throw new BadRequestError("Category must be a leaf (subcategory) of the taxonomy");
      }
    }
    await this.itemsRepository.updateCategory(id, input.categoryId, input.confirmed ?? true, null);
    return this.getItemDetail(id, businessId);
  }

  /**
   * Rename an item's canonical name — the single place that controls the concise/refined name
   * used everywhere downstream this item is referenced by name (RFQ vendor-facing text going
   * forward, rate-matching, price history grouping). Identity is exact-match, so a collision
   * with another item's name is rejected rather than merged — merging price histories is a
   * separate, not-yet-built feature (see Item.canonicalName's schema comment).
   */
  async renameItem(id: string, businessId: string, canonicalName: string): Promise<ItemDetailDto> {
    await this.getItemOrThrow(id, businessId);
    const trimmed = collapseWhitespace(canonicalName);
    const existing = await this.itemsRepository.findByCanonicalName(businessId, trimmed);
    if (existing && existing.id !== id) {
      throw new ConflictError("An item with this name already exists");
    }
    await this.itemsRepository.renameItem(id, trimmed);
    return this.getItemDetail(id, businessId);
  }

  /** AI-classify a single item into the taxonomy, leaving it unconfirmed for review. */
  async classifyItem(id: string, businessId: string, actorId: string): Promise<ItemDetailDto> {
    const item = await this.itemsRepository.getForClassify(id, businessId);
    if (!item) throw new NotFoundError("Item not found");
    const context = await this.loadClassifyContext(businessId);
    const result = await this.suggestForItem(item, context, businessId, actorId);
    await this.itemsRepository.updateCategory(id, result.categoryId, false, result.confidence || null);
    return this.getItemDetail(id, businessId);
  }

  /** Batch-classify a page of still-unclassified items. Small batch: each is at most one LLM call. */
  async classifyUnclassified(
    businessId: string,
    limit: number,
    actorId: string,
  ): Promise<{ classified: number; unmatched: number; failed: number; remaining: number }> {
    const context = await this.loadClassifyContext(businessId);
    const items = await this.itemsRepository.findUnclassified(businessId, limit);

    let classified = 0;
    let unmatched = 0;
    let failed = 0;
    for (const item of items) {
      try {
        const result = await this.suggestForItem(item, context, businessId, actorId);
        await this.itemsRepository.updateCategory(item.id, result.categoryId, false, result.confidence || null);
        // The model legitimately returns null ("none fit"); that is not a category, and the
        // item stays unclassified (and retryable) rather than being counted as done.
        if (result.categoryId) classified += 1;
        else unmatched += 1;
      } catch (err) {
        // Ollama being down is a whole-batch failure; one unusable item is not.
        if (err instanceof ServiceUnavailableError) throw err;
        logger.warn({ itemId: item.id, err }, "Skipped item classification");
        failed += 1;
      }
    }

    const remaining = await this.itemsRepository.countUnclassified(businessId);
    return { classified, unmatched, failed, remaining };
  }

  /** Leaves, category paths, and confirmed match-candidates (with embeddings ensured) for a run. */
  private async loadClassifyContext(businessId: string): Promise<{
    leaves: CategoryLeafDto[];
    pathMap: Map<string, string>;
  }> {
    const [leaves, pathMap, confirmed] = await Promise.all([
      this.requireLeaves(),
      this.categoriesService.getPathMap(),
      this.itemsRepository.findConfirmedForMatch(businessId),
    ]);

    // Converge-on-use: embed any confirmed candidate that isn't embedded yet, so the pool of
    // reusable human decisions grows without a separate backfill (mirrors embedPendingRates).
    // This fetch is unrelated to matching (that's ANN, per-item, in suggestForItem below) — it
    // exists purely to find rows that still need an embedding at all.
    const pending = confirmed.filter((c) => !c.embeddedAt || c.embedding.length === 0);
    if (pending.length > 0) {
      const vectors = await this.safeEmbed(pending.map((c) => c.canonicalName));
      for (const [index, candidate] of pending.entries()) {
        const vector = vectors[index];
        if (vector) await this.itemsRepository.setEmbedding(candidate.id, vector);
      }
    }

    return { leaves, pathMap };
  }

  /**
   * The human-feedback loop, in order:
   *   Rung 1 — reuse a confirmed sibling's category outright if one matches on all three signals
   *            (cosine, identical specs, unit). Deterministic, no LLM, no drift across sizes.
   *   Rung 2 — otherwise fall back to the LLM, but ground it with the NEAREST confirmed items
   *            (by embedding) rather than arbitrary recent ones, so past confirmations steer it
   *            (e.g. a confirmed "PU Tube 4x6 -> Piping" pulls a new "PU Tube 7x10" the same way).
   * Either way the result lands unconfirmed for review.
   *
   * Every call is logged to AuditLog (action ITEM_CLASSIFIED) with which path decided it and
   * enough of the input/context to replay later — the point is a growing record of how much of
   * the catalog resolves deterministically (sibling reuse) vs. still needs the LLM, per category,
   * so that question can be answered from data instead of impression once there's enough of it.
   */
  private async suggestForItem(
    item: ItemForClassify,
    context: { leaves: CategoryLeafDto[]; pathMap: Map<string, string> },
    businessId: string,
    actorId: string,
  ): Promise<ClassificationResult> {
    let embedding = item.embedding;
    if (!item.embeddedAt || embedding.length === 0) {
      embedding = (await this.safeEmbed([item.canonicalName]))[0] ?? [];
      if (embedding.length > 0) await this.itemsRepository.setEmbedding(item.id, embedding);
    }

    // One ANN query serves both downstream consumers: the sibling-reuse check (needs only the
    // nearest candidate) and the LLM's few-shot examples (needs up to CLASSIFY_EXAMPLE_LIMIT).
    const nearest =
      embedding.length > 0
        ? await this.itemsRepository.findNearestConfirmedMatch(businessId, item.id, embedding, CLASSIFY_EXAMPLE_LIMIT)
        : [];

    const sibling = pickConfirmedMatch(
      { canonicalName: item.canonicalName, unit: item.unit },
      nearest[0] ?? null,
      env.AI_MATCH_THRESHOLD,
    );
    if (sibling) {
      const match = nearest[0]!;
      await this.logClassification(actorId, item, {
        path: "sibling_reuse",
        categoryId: sibling.categoryId,
        confidence: sibling.confidence,
        matchedItemId: match.id,
        matchedCanonicalName: match.canonicalName,
        candidateCount: nearest.length,
      });
      return sibling;
    }

    // Nearest confirmed examples ground the LLM — the practical "learn from feedback" lever.
    const examples = nearest
      .map((row) => ({ name: row.canonicalName, path: context.pathMap.get(row.categoryId) ?? "" }))
      .filter((e) => e.path);

    const prompt = buildClassifyPrompt(item.canonicalName, item.unit, context.leaves, examples);
    const raw = await generateJson(prompt, env.OLLAMA_ENRICHMENT_MODEL);
    const result = parseClassification(raw, new Set(context.leaves.map((l) => l.id)));
    await this.logClassification(actorId, item, {
      path: "llm",
      categoryId: result.categoryId,
      confidence: result.confidence,
      model: env.OLLAMA_ENRICHMENT_MODEL,
      exampleCount: examples.length,
      candidateCount: nearest.length,
      nearestSimilarity: nearest[0]?.similarity ?? null,
    });
    return result;
  }

  private async logClassification(
    actorId: string,
    item: ItemForClassify,
    details:
      | {
          path: "sibling_reuse";
          categoryId: string | null;
          confidence: number;
          matchedItemId: string;
          matchedCanonicalName: string;
          candidateCount: number;
        }
      | {
          path: "llm";
          categoryId: string | null;
          confidence: number;
          model: string;
          exampleCount: number;
          candidateCount: number;
          nearestSimilarity: number | null;
        },
  ): Promise<void> {
    await this.auditService.log({
      actorId,
      action: "ITEM_CLASSIFIED",
      entityType: "Item",
      entityId: item.id,
      metadata: {
        canonicalName: item.canonicalName,
        unit: item.unit,
        ...details,
      },
    });
  }

  /**
   * Embeddings are an enhancement, not a hard dependency: if the embed model is unavailable
   * (e.g. only the generation model is pulled), degrade to plain LLM classification rather than
   * failing the whole request.
   */
  private async safeEmbed(texts: string[]): Promise<number[][]> {
    try {
      return await embed(texts);
    } catch (err) {
      logger.warn({ err }, "Item embedding failed; classifying without sibling reuse");
      return [];
    }
  }

  private async requireLeaves(): Promise<CategoryLeafDto[]> {
    const leaves = await this.categoriesService.getLeaves();
    if (leaves.length === 0) throw new BadRequestError("No categories defined to classify into");
    return leaves;
  }

  private async getItemOrThrow(id: string, businessId: string): Promise<ItemRow> {
    const item = await this.itemsRepository.findById(id, businessId);
    if (!item) throw new NotFoundError("Item not found");
    return item;
  }
}
