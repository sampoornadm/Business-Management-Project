import { env } from "../../config/env.js";
import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";
import { embed, generateJson } from "../../infra/llm/ollama.client.js";
import { logger } from "../../shared/logger/logger.js";
import { round2 } from "../../shared/utils/math.js";
import { sameSpec } from "../../shared/utils/spec-match.js";
import type {
  HistoricalRateMatch,
  IHistoricalRatesRepository,
} from "../rates/rates.repository.js";

import type { IBoqRepository, UpdateBoqItemEnrichmentData } from "./boq.repository.js";

/** How many historical candidates get handed to the LLM as context on the fallback path. */
const LLM_CONTEXT_CANDIDATES = 3;

/** How many nearest historical rates the ANN query returns per item, before threshold filtering. */
const RATE_MATCH_CANDIDATES = 10;

/**
 * The LLM self-reports its own confidence, which is not calibrated against anything.
 * Clamping it below AI_MATCH_THRESHOLD keeps the two paths ordered: an "llm" result can
 * never outrank a real historical match in the UI.
 * ponytail: a self-reported number with a ceiling. Real calibration would need a labelled
 * set of past classifications to score against — revisit once enough items are reviewed.
 */
const LLM_CONFIDENCE_CEILING = 0.9;

interface LlmClassification {
  normalizedName: string;
  category: string;
  subcategory: string | null;
  confidence: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Ollama is told to return this shape, but it's still an LLM — validate before trusting. */
function parseClassification(raw: unknown): LlmClassification | null {
  if (!isRecord(raw)) return null;

  const normalizedName = typeof raw.normalizedName === "string" ? raw.normalizedName.trim() : "";
  const category = typeof raw.category === "string" ? raw.category.trim() : "";
  if (!normalizedName || !category) return null;

  const subcategory =
    typeof raw.subcategory === "string" && raw.subcategory.trim() ? raw.subcategory.trim() : null;
  const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
    ? Math.min(Math.max(raw.confidence, 0), 1)
    : 0.5;

  return { normalizedName, category, subcategory, confidence };
}

/**
 * Classification only — the model is never asked to pick a rate. Nearby historical items are
 * included purely so it reuses this company's own category vocabulary instead of inventing
 * new labels for the same trade.
 */
function buildPrompt(description: string, unit: string | null, candidates: HistoricalRateMatch[]): string {
  const context = candidates.length
    ? candidates.map((c) => `  - "${c.itemName}" (category: ${c.category})`).join("\n")
    : "  (none)";

  return [
    "You classify line items from a construction tender's Bill of Quantities.",
    "",
    `Item description: "${description}"`,
    `Item unit: ${unit ?? "unknown"}`,
    "",
    "Similar items this company has priced before, for category vocabulary:",
    context,
    "",
    "Return JSON only, with exactly these keys:",
    '  "normalizedName": the description rewritten as a short canonical name, preserving every',
    '                    size, grade and material exactly (e.g. "XLPE Cable 4C x16")',
    '  "category": a broad trade category (e.g. "Electrical", "Civil", "Plumbing")',
    '  "subcategory": a narrower type within that category (e.g. "Cable"), or null',
    '  "confidence": your confidence in this classification, 0 to 1',
  ].join("\n");
}

export class BoqEnrichmentService {
  constructor(
    private readonly boqRepository: IBoqRepository,
    private readonly ratesRepository: IHistoricalRatesRepository,
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
  ): Promise<UpdateBoqItemEnrichmentData> {
    const best = matches[0];

    // A rate is only ever suggested when this is provably the SAME item: near-exact wording,
    // identical numeric specs, and the same unit. All three are required — see sameSpec()
    // above for why neither the embedding nor the LLM is trusted with this call.
    const matched =
      best !== undefined &&
      best.similarity >= env.AI_MATCH_THRESHOLD &&
      sameSpec(description, best.itemName) &&
      (unit === null || best.unit === unit)
        ? best
        : null;

    // The LLM always classifies, even when a rate matched. HistoricalRate.category is a
    // cost-type (MATERIAL/LABOR/...), not a trade, so it cannot fill aiCategory — reusing it
    // would make aiCategory mean "Electrical" on one row and "MATERIAL" on the next. The
    // model is only asked what it's measurably good at (naming and categorising); pricing
    // stays with the deterministic check above.
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

    return {
      normalizedName: matched ? matched.itemName : parsed.normalizedName,
      aiCategory: parsed.category,
      aiSubcategory: parsed.subcategory,
      // A matched rate is backed by a measured near-exact match; a classification is only the
      // model's own say-so, so it never scores as high.
      aiConfidence: matched
        ? round2(matched.similarity)
        : round2(Math.min(parsed.confidence, LLM_CONFIDENCE_CEILING)),
      suggestedRate: matched?.rate ?? null,
      aiSource: matched ? "historical" : "llm",
      aiRateSourceId: matched?.id ?? null,
      aiEnrichedAt: new Date(),
    };
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
    const itemVectors = await embed(leaves.map((item) => item.description));

    let enriched = 0;
    for (const [index, item] of leaves.entries()) {
      const vector = itemVectors[index];
      if (!vector) continue;

      // One bad item (unusable LLM output) must not abandon the rest of the BOQ.
      try {
        const matches = await this.ratesRepository.findNearest(businessId, vector, RATE_MATCH_CANDIDATES);
        const enrichment = await this.classify(item.description, item.unit, matches);
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
