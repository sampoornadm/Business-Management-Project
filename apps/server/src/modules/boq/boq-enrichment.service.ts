import { env } from "../../config/env.js";
import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";
import { embed, generateJson } from "../../infra/llm/ollama.client.js";
import { logger } from "../../shared/logger/logger.js";
import { round2 } from "../../shared/utils/math.js";
import { sameSpec } from "../../shared/utils/spec-match.js";
import type { CategoriesService } from "../categories/categories.service.js";
import { deriveCanonicalName } from "../items/items.helpers.js";
import type { IItemsRepository } from "../items/items.repository.js";
import type {
  HistoricalRateMatch,
  IHistoricalRatesRepository,
} from "../rates/rates.repository.js";
import type { IHsnClassifier } from "../classification/classification.service.js";
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

/** Tariff code -> "Chapter > Heading", so a resolved HSN code yields the category directly. */
interface CategoryContext {
  pathByCode: Map<string, string>;
}

/**
 * The LLM self-reports its own confidence, which is not calibrated against anything.
 * Clamping it below AI_MATCH_THRESHOLD keeps the two paths ordered: an "llm" result can
 * never outrank a real historical match in the UI.
 * ponytail: a self-reported number with a ceiling. Real calibration would need a labelled
 * set of past classifications to score against — revisit once enough items are reviewed.
 */
const LLM_CONFIDENCE_CEILING = 0.9;

// GST rates are no longer guessed. They come from the resolved HSN heading, via the rates the user
// curates in ml/data/hsn-gst-lookup.xlsx. The old code asked the model for a percentage and snapped
// it to the nearest of [0, 5, 12, 18, 28] — those slabs stopped existing on 22 Sep 2025 (the 12%
// slab merged into 18%, 28% became 40% for sin goods), so it was snapping to a table that was both
// wrong and, being a guess, never authoritative in the first place.

interface LlmClassification {
  normalizedName: string;
  confidence: number;
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

  return { normalizedName, confidence };
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
    private readonly classifier: IHsnClassifier,
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
    catalogHsn: { hsnCode: string; gstRate: number | null } | null,
    hsnAlreadyConfirmed: boolean,
    vector: number[],
    businessId: string,
    itemId: string,
    canonicalName: string,
    categoryContext: CategoryContext,
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

    // Rate order: a human-confirmed catalog rate, else the rate the user curates against this
    // heading in the lookup sheet, else nothing. Never a model guess — an invented tax rate that
    // looks plausible is worse than an empty field, because nobody goes back to check it.
    const gstRate =
      catalogHsn?.gstRate ??
      (suggestedHsnCode ? await this.referenceDataRepository.findGstRateByCode(suggestedHsnCode) : null);

    const category = this.categoryForHsnCode(suggestedHsnCode, categoryContext);

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
    // The trained classifier owns this decision when it is installed. It answers from the item text
    // alone in one forward pass, where the path below needed an embedding lookup plus an LLM call
    // and still scored 0 correct out of 22 on real purchase-order lines.
    if (await this.classifier.isAvailable()) {
      const minConfidence = await this.settingsService.get<number>("CLASSIFIER_MIN_CONFIDENCE");
      const result = await this.classifier.classify(description);

      // Abstention is an answer. Below the calibrated threshold the item is left unclassified
      // rather than handed a guess — there is deliberately no second opinion to fall through to,
      // because the thing it would fall through to is what this replaced.
      if (result.abstained || !result.headingCode) return null;
      if (result.confidence < minConfidence) return null;
      return { code: result.headingCode, description: "" };
    }

    // No model installed — a fresh clone, or a deployment where ml/train has not run. Keep doing
    // what the app did before rather than silently stopping: worse, but not nothing.
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
  /**
   * Tariff code -> "Chapter > Heading", built once per BOQ. Loop-invariant, same reason
   * embedPendingRates runs once up here rather than per item.
   */
  private async loadCategoryContext(): Promise<CategoryContext> {
    const [leaves, pathMap] = await Promise.all([
      this.categoriesService.getLeaves(),
      this.categoriesService.getPathMap(),
    ]);

    const pathByCode = new Map<string, string>();
    for (const leaf of leaves) {
      if (leaf.code) pathByCode.set(leaf.code, pathMap.get(leaf.id) ?? leaf.name);
    }
    return { pathByCode };
  }

  /**
   * The category IS the tariff heading, so it comes from the resolved HSN code rather than a second
   * opinion. This is the point of deriving the taxonomy from CBIC: one decision now yields the
   * category, the subcategory and the HSN code, and they cannot disagree with each other.
   *
   * It also retires a call that had become impossible. The previous path asked the LLM to choose
   * from a closed list built by rendering every leaf id and path into the prompt — fine for the old
   * 38-leaf trade tree, hopeless at 1,379 headings with UUIDs, where it answered "Wood and articles
   * of wood > Railway or tramway sleepers of wood" for a spring steel washer.
   */
  private categoryForHsnCode(
    hsnCode: string | null,
    categoryContext: CategoryContext,
  ): { category: string; subcategory: string | null } | null {
    if (!hsnCode) return null;

    const path = categoryContext.pathByCode.get(hsnCode);
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
    const categoryContext = await this.loadCategoryContext();
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
          categoryContext,
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
