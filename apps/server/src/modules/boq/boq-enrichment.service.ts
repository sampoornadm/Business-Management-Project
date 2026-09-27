import type { CategoryLeafDto } from "@bmp/types";

import { env } from "../../config/env.js";
import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";
import { embed, generateJson } from "../../infra/llm/ollama.client.js";
import { logger } from "../../shared/logger/logger.js";
import { round2 } from "../../shared/utils/math.js";
import { sameSpec } from "../../shared/utils/spec-match.js";
import type { CategoriesService } from "../categories/categories.service.js";
import {
  buildClassifyPrompt,
  deriveCanonicalName,
  parseClassification as parseCategoryClassification,
  pickConfirmedMatch,
} from "../items/items.helpers.js";
import type { IItemsRepository } from "../items/items.repository.js";
import type {
  HistoricalRateMatch,
  IHistoricalRatesRepository,
} from "../rates/rates.repository.js";
import { matchHsnByKeyword } from "../reference-data/hsn-keyword-rules.js";
import { buildHsnMatchPrompt, parseHsnMatch } from "../reference-data/hsn-matcher.js";
import type { IReferenceDataRepository } from "../reference-data/reference-data.repository.js";
import type { SettingsService } from "../settings/settings.service.js";

import type { IBoqRepository, UpdateBoqItemEnrichmentData } from "./boq.repository.js";

/** How many historical candidates get handed to the LLM as context on the fallback path. */
const LLM_CONTEXT_CANDIDATES = 3;

/** How many nearest historical rates the ANN query returns per item, before threshold filtering. */
const RATE_MATCH_CANDIDATES = 10;

/** Matching only targets 4-digit HSN headings for now — see the design spec's scope boundary. */
const HSN_CODE_LENGTH = 4;
/** How many ANN-retrieved HSN headings the LLM is offered to pick from. */
const HSN_CANDIDATE_LIMIT = 8;

/** Mirrors items.service.ts's CLASSIFY_EXAMPLE_LIMIT — same ANN call shape, same window size. */
const CATEGORY_EXAMPLE_LIMIT = 20;

/**
 * The LLM self-reports its own confidence, which is not calibrated against anything.
 * Clamping it below AI_MATCH_THRESHOLD keeps the two paths ordered: an "llm" result can
 * never outrank a real historical match in the UI.
 * ponytail: a self-reported number with a ceiling. Real calibration would need a labelled
 * set of past classifications to score against — revisit once enough items are reviewed.
 */
const LLM_CONFIDENCE_CEILING = 0.9;

/**
 * Indian GST slabs. The LLM's own percentage guess is unreliable at the exact number (e.g.
 * "17.5%" isn't a real slab) — snapping to the nearest real slab is a cheap deterministic
 * guard on top of the guess, same spirit as sameSpec() gating a rate match.
 */
const GST_SLABS = [0, 5, 12, 18, 28];

function snapToGstSlab(value: number): number {
  return GST_SLABS.reduce((closest, slab) =>
    Math.abs(slab - value) < Math.abs(closest - value) ? slab : closest,
  );
}

interface LlmClassification {
  normalizedName: string;
  confidence: number;
  gstRatePercent: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Ollama is told to return this shape, but it's still an LLM — validate before trusting. */
function parseClassification(raw: unknown): LlmClassification | null {
  if (!isRecord(raw)) return null;

  const normalizedName = typeof raw.normalizedName === "string" ? raw.normalizedName.trim() : "";
  if (!normalizedName) return null;

  const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
    ? Math.min(Math.max(raw.confidence, 0), 1)
    : 0.5;
  const gstRatePercent =
    typeof raw.gstRatePercent === "number" && Number.isFinite(raw.gstRatePercent)
      ? snapToGstSlab(raw.gstRatePercent)
      : null;

  return { normalizedName, confidence, gstRatePercent };
}

/**
 * Naming and GST-rate guessing only — trade category is a separate, grounded call (see
 * classifyCategory below); this free-text prompt used to also ask for "category"/"subcategory"
 * directly, which is exactly the ungrounded-guess problem the HSN matcher already had to fix for
 * hsnCode (same trap: items that are obviously the same trade got different free-text labels
 * independently per call — see hsn-keyword-rules.ts's design note for the pattern).
 */
function buildPrompt(description: string, unit: string | null, candidates: HistoricalRateMatch[]): string {
  const context = candidates.length
    ? candidates.map((c) => `  - "${c.itemName}"`).join("\n")
    : "  (none)";

  return [
    "You name and price-classify a line item from a construction tender's Bill of Quantities.",
    "",
    `Item description: "${description}"`,
    `Item unit: ${unit ?? "unknown"}`,
    "",
    "Similar items this company has priced before, for naming vocabulary:",
    context,
    "",
    "Return JSON only, with exactly these keys:",
    '  "normalizedName": the description rewritten as a short canonical name, preserving every',
    '                    size, grade and material exactly (e.g. "XLPE Cable 4C x16"). Drop any',
    '                    trailing clause about what the item is used for, installed in, or applied',
    '                    to (e.g. "...for steel teeming ladle auto coupling system") - that is',
    "                    context for this tender, not part of the item's own identity, and a",
    "                    vendor being quoted this name doesn't need it. Never drop a real spec",
    "                    (size, grade, material, standard) even if it appears late in the sentence.",
    '  "confidence": your confidence in this naming, 0 to 1',
    '  "gstRatePercent": the Indian GST rate percent for this item — one of 0, 5, 12, 18, 28 —',
    "                     or null if unsure",
  ].join("\n");
}

export class BoqEnrichmentService {
  constructor(
    private readonly boqRepository: IBoqRepository,
    private readonly ratesRepository: IHistoricalRatesRepository,
    private readonly itemsRepository: IItemsRepository,
    private readonly referenceDataRepository: IReferenceDataRepository,
    private readonly settingsService: SettingsService,
    private readonly categoriesService: CategoriesService,
  ) {}

  /**
   * Embeds any HistoricalRate rows this business hasn't embedded yet. Lazy on purpose:
   * no backfill script and no hook in rates.service — rows created before this feature
   * shipped, and rows created after it, both converge here on first use.
   */
  private async embedPendingRates(businessId: string): Promise<void> {
    const pending = await this.ratesRepository.findUnembedded(businessId);
    if (pending.length === 0) return;

    const vectors = await embed(pending.map((rate) => rate.itemName));
    for (const [index, rate] of pending.entries()) {
      const vector = vectors[index];
      if (vector) await this.ratesRepository.setEmbedding(rate.id, vector);
    }
    logger.info({ businessId, count: pending.length }, "Embedded historical rates");
  }

  private async classify(
    description: string,
    unit: string | null,
    matches: HistoricalRateMatch[],
    catalogHsn: { hsnCode: string; gstRate: number } | null,
    hsnAlreadyConfirmed: boolean,
    vector: number[],
    businessId: string,
    itemId: string,
    canonicalName: string,
    categoryContext: { leaves: CategoryLeafDto[]; pathMap: Map<string, string> },
  ): Promise<UpdateBoqItemEnrichmentData> {
    const best = matches[0];
    const matchThreshold = await this.settingsService.get<number>("AI_MATCH_THRESHOLD");

    // A rate is only ever suggested when this is provably the SAME item: near-exact wording,
    // identical numeric specs, and the same unit. All three are required — see sameSpec()
    // above for why neither the embedding nor the LLM is trusted with this call.
    const matched =
      best !== undefined &&
      best.similarity >= matchThreshold &&
      sameSpec(description, best.itemName) &&
      (unit === null || best.unit === unit)
        ? best
        : null;

    // The LLM always names the item, even when a rate matched — pricing stays with the
    // deterministic check above; naming and GST-rate guessing are what it's measurably good at.
    // Trade category is a separate, grounded call (classifyCategory below), not this free text.
    const raw = await generateJson(
      buildPrompt(
        description,
        unit,
        matches.filter((m) => m.similarity >= env.AI_CONTEXT_FLOOR).slice(0, LLM_CONTEXT_CANDIDATES),
      ),
      env.OLLAMA_ENRICHMENT_MODEL,
    );
    const parsed = parseClassification(raw);
    if (!parsed) throw new ServiceUnavailableError("Ollama returned an unusable classification.");

    // A confirmed catalog match always outranks a fresh match for the same call — same "human
    // feedback beats a fresh guess" rule the rate/category matching already use. A fresh match
    // is never trusted enough to become the real hsnCode — see the spread below.
    const freshMatch = catalogHsn ? null : await this.matchHsnCode(description, unit, vector);
    const hsnCode = catalogHsn?.hsnCode ?? null;
    const suggestedHsnCode = catalogHsn?.hsnCode ?? freshMatch?.code ?? null;
    const gstRate = catalogHsn?.gstRate ?? parsed.gstRatePercent;

    const category = await this.classifyCategory(
      canonicalName,
      unit,
      vector,
      businessId,
      itemId,
      categoryContext,
      matchThreshold,
    );

    return {
      normalizedName: matched ? matched.itemName : parsed.normalizedName,
      aiCategory: category?.category ?? null,
      aiSubcategory: category?.subcategory ?? null,
      // A matched rate is backed by a measured near-exact match; a classification is only the
      // model's own say-so, so it never scores as high.
      aiConfidence: matched
        ? round2(matched.similarity)
        : round2(Math.min(parsed.confidence, LLM_CONFIDENCE_CEILING)),
      suggestedRate: matched?.rate ?? null,
      aiSource: matched ? "historical" : "llm",
      aiRateSourceId: matched?.id ?? null,
      aiEnrichedAt: new Date(),
      suggestedHsnCode,
      suggestedGstRate: gstRate,
      // hsnCode (the real billing field) is only ever set by an explicit human action — typing
      // over it, clicking Apply on a suggestion, or (here) a catalog match a human already
      // confirmed for this exact item elsewhere. A fresh, never-confirmed match only ever lands
      // in suggestedHsnCode above. GST rate keeps its original auto-fill behavior (unchanged —
      // out of scope here, see the design spec). Once a human has confirmed hsnCode
      // (hsnAlreadyConfirmed), never touch it again — omitting the key (not writing
      // null/undefined explicitly) makes Prisma leave it alone.
      ...(!hsnAlreadyConfirmed && hsnCode !== null ? { hsnCode } : {}),
      ...(!hsnAlreadyConfirmed && gstRate !== null ? { gstRate } : {}),
    };
  }

  /**
   * ANN-retrieves real HSN headings close to this item's embedding, then asks the model to pick
   * one of them — never lets it invent a code. See hsn-matcher.ts for why this specific shape
   * makes the wrong-chapter hallucination (7310/7318/7321/... for a pipe fitting) structurally
   * impossible.
   */
  private async matchHsnCode(
    description: string,
    unit: string | null,
    vector: number[],
  ): Promise<{ code: string; description: string } | null> {
    // Checked before the ANN/LLM path — cheaper, and a measured fix for phrasing that path gets
    // wrong. See hsn-keyword-rules.ts for the grounding and the real mismatches it corrects.
    const keywordMatch = matchHsnByKeyword(description);
    if (keywordMatch) return keywordMatch;

    const candidates = await this.referenceDataRepository.findNearestHsn(
      vector,
      HSN_CODE_LENGTH,
      HSN_CANDIDATE_LIMIT,
    );
    if (candidates.length === 0) return null;

    const raw = await generateJson(
      buildHsnMatchPrompt(description, unit, candidates),
      env.OLLAMA_ENRICHMENT_MODEL,
    );
    const code = parseHsnMatch(raw, new Set(candidates.map((c) => c.code)));
    if (!code) return null;
    const match = candidates.find((c) => c.code === code);
    return match ? { code: match.code, description: match.description } : null;
  }

  /**
   * Same two-rung shape as items.service.ts#suggestForItem (that pipeline is where this one was
   * copied from) — reused here rather than forked, because BOQ's aiCategory/aiSubcategory used
   * to be a free-text LLM guess with no retrieval and no closed vocabulary, so items that are
   * obviously the same trade could land on different labels independently per call. Same failure
   * shape the HSN matcher already had to fix for hsnCode (see hsn-keyword-rules.ts).
   *
   * Rung 1 — reuse a confirmed catalog sibling's category outright if one matches on cosine,
   * identical specs, and unit (pickConfirmedMatch, deterministic, no LLM).
   * Rung 2 — otherwise the LLM picks from the real leaf category list, never inventing one
   * (parseClassification rejects any id not in that list).
   *
   * `itemId` excludes nothing here (a BoqItem id never collides with an Items-catalog id, since
   * they're different tables) — it's only meaningful for items.service.ts's own self-match
   * exclusion, kept for signature compatibility with the shared repository method.
   */
  private async classifyCategory(
    canonicalName: string,
    unit: string | null,
    vector: number[],
    businessId: string,
    itemId: string,
    categoryContext: { leaves: CategoryLeafDto[]; pathMap: Map<string, string> },
    matchThreshold: number,
  ): Promise<{ category: string; subcategory: string | null } | null> {
    const { leaves, pathMap } = categoryContext;
    if (leaves.length === 0) return null;

    const nearest = await this.itemsRepository.findNearestConfirmedMatch(
      businessId,
      itemId,
      vector,
      CATEGORY_EXAMPLE_LIMIT,
    );

    const sibling = pickConfirmedMatch({ canonicalName, unit }, nearest, matchThreshold);
    let categoryId = sibling?.categoryId ?? null;

    if (!categoryId) {
      const examples = nearest
        .map((row) => ({ name: row.canonicalName, path: pathMap.get(row.categoryId) ?? "" }))
        .filter((e) => e.path);
      const raw = await generateJson(
        buildClassifyPrompt(canonicalName, unit, leaves, examples),
        env.OLLAMA_ENRICHMENT_MODEL,
      );
      categoryId = parseCategoryClassification(raw, new Set(leaves.map((l) => l.id))).categoryId;
    }
    if (!categoryId) return null;

    const path = pathMap.get(categoryId);
    if (!path) return null;
    const parts = path.split(" > ");
    return { category: parts[0]!, subcategory: parts.length > 1 ? parts[parts.length - 1]! : null };
  }

  /**
   * Enriches every item on a BOQ in place. Safe to re-run — each run overwrites only the
   * ai* columns, never estimator-entered data.
   */
  async enrichBoq(boqId: string, businessId: string): Promise<void> {
    const items = await this.boqRepository.findItemsByBoqId(boqId);
    // Section headers carry no rate and nothing to match on.
    const leaves = items.filter((item) => item.quantity !== null || item.rate !== null);
    if (leaves.length === 0) return;

    await this.embedPendingRates(businessId);
    // Category leaves/paths are the same for every item on this BOQ — fetched once, not per
    // item, same reason embedPendingRates runs once up here instead of inside the loop.
    const [categoryLeaves, categoryPathMap] = await Promise.all([
      this.categoriesService.getLeaves(),
      this.categoriesService.getPathMap(),
    ]);
    // Prefer normalizedName when this item was already enriched once (a re-run) — it's the
    // use-case-stripped, spec-only form, which is what should drive the historical-rate ANN
    // search. A first-time pass has no normalizedName yet (it's this call's own output, via
    // classify() below), so it necessarily still searches on the raw description.
    const itemVectors = await embed(leaves.map((item) => item.normalizedName || item.description));

    let enriched = 0;
    for (const [index, item] of leaves.entries()) {
      const vector = itemVectors[index];
      if (!vector) continue;

      // One bad item (unusable LLM output) must not abandon the rest of the BOQ.
      try {
        const matches = await this.ratesRepository.findNearest(businessId, vector, RATE_MATCH_CANDIDATES);
        const canonicalName = deriveCanonicalName(item.normalizedName, item.description);
        const catalogHsn = await this.itemsRepository.findConfirmedHsn(businessId, canonicalName);
        const enrichment = await this.classify(
          item.description,
          item.unit,
          matches,
          catalogHsn,
          item.hsnCodeConfirmed,
          vector,
          businessId,
          item.id,
          canonicalName,
          { leaves: categoryLeaves, pathMap: categoryPathMap },
        );
        await this.boqRepository.updateItemEnrichment(item.id, enrichment);
        enriched += 1;
      } catch (err) {
        if (err instanceof ServiceUnavailableError) throw err;
        logger.warn({ itemId: item.id, err }, "Skipped BOQ item enrichment");
      }
    }

    logger.info({ boqId, enriched, total: leaves.length }, "BOQ enrichment complete");
  }
}
