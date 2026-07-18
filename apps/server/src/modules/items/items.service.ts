import type {
  CategoryLeafDto,
  ItemDetailDto,
  ItemListEntryDto,
  ItemSortField,
  PaginatedResult,
} from "@bmp/types";

import { env } from "../../config/env.js";
import { BadRequestError, NotFoundError, ServiceUnavailableError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";
import { generateJson } from "../../infra/llm/ollama.client.js";
import { logger } from "../../shared/logger/logger.js";
import type { CategoriesService } from "../categories/categories.service.js";
import type { RfqService } from "../rfq/rfq.service.js";

import {
  buildClassifyPrompt,
  type ClassificationResult,
  deriveCanonicalName,
  parseClassification,
} from "./items.helpers.js";
import { aggregateQuotes, sortItemEntries, toItemDetailDto, toItemListEntryDto } from "./items.mapper.js";
import type { IItemsRepository, ItemRow } from "./items.repository.js";

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

  /** AI-classify a single item into the taxonomy, leaving it unconfirmed for review. */
  async classifyItem(id: string, businessId: string): Promise<ItemDetailDto> {
    const item = await this.getItemOrThrow(id, businessId);
    const leaves = await this.requireLeaves();
    const examples = await this.buildExamples(businessId);
    const result = await this.classifyOne(item, leaves, examples);
    await this.itemsRepository.updateCategory(id, result.categoryId, false, result.confidence || null);
    return this.getItemDetail(id, businessId);
  }

  /** Batch-classify a page of still-unclassified items. Small batch: each is one LLM call. */
  async classifyUnclassified(
    businessId: string,
    limit: number,
  ): Promise<{ classified: number; unmatched: number; failed: number; remaining: number }> {
    const leaves = await this.requireLeaves();
    const examples = await this.buildExamples(businessId);
    const items = await this.itemsRepository.findUnclassified(businessId, limit);

    let classified = 0;
    let unmatched = 0;
    let failed = 0;
    for (const item of items) {
      try {
        const result = await this.classifyOne(item, leaves, examples);
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

  private async classifyOne(
    item: ItemRow,
    leaves: CategoryLeafDto[],
    examples: Array<{ name: string; path: string }>,
  ): Promise<ClassificationResult> {
    const prompt = buildClassifyPrompt(item.canonicalName, item.unit, leaves, examples);
    const raw = await generateJson(prompt, env.OLLAMA_ENRICHMENT_MODEL);
    return parseClassification(raw, new Set(leaves.map((l) => l.id)));
  }

  private async buildExamples(businessId: string): Promise<Array<{ name: string; path: string }>> {
    const [examples, pathMap] = await Promise.all([
      this.itemsRepository.findConfirmedExamples(businessId, CLASSIFY_EXAMPLE_LIMIT),
      this.categoriesService.getPathMap(),
    ]);
    return examples
      .map((e) => ({ name: e.canonicalName, path: pathMap.get(e.categoryId) ?? "" }))
      .filter((e) => e.path);
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
