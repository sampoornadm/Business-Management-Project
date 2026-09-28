import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceUnavailableError } from "../../../core/errors/HttpErrors.js";
import { cosineSimilarity } from "../../../shared/utils/math.js";
import type { CategoriesService } from "../../categories/categories.service.js";
import type { IItemsRepository, NearestConfirmedMatch } from "../../items/items.repository.js";
import type {
  CreateHistoricalRateData,
  HistoricalRateMatch,
  HistoricalRateVector,
  HistoricalRateWithCreator,
  IHistoricalRatesRepository,
  ListHistoricalRatesFilters,
} from "../../rates/rates.repository.js";
import type { HsnCandidate, IReferenceDataRepository } from "../../reference-data/reference-data.repository.js";
import type { SettingsService } from "../../settings/settings.service.js";
import type { IHsnClassifier } from "../../classification/classification.service.js";
import { BoqEnrichmentService } from "../boq-enrichment.service.js";
import type {
  BoqItemWithBreakdown,
  IBoqRepository,
  UpdateBoqItemEnrichmentData,
} from "../boq.repository.js";

const { embedMock, generateJsonMock } = vi.hoisted(() => ({
  embedMock: vi.fn(),
  generateJsonMock: vi.fn(),
}));

vi.mock("../../../infra/llm/ollama.client.js", () => ({
  embed: embedMock,
  generateJson: generateJsonMock,
}));

const BUSINESS_ID = randomUUID();
const BOQ_ID = randomUUID();

/** Unit vectors: cosine similarity here is exactly cos(angle), easy to reason about. */
const CABLE_VECTOR = [1, 0];
const NEAR_CABLE_VECTOR = [0.999, 0.0447]; // ~0.999 similarity — clears AI_MATCH_THRESHOLD (0.98)
const SIMILAR_CABLE_VECTOR = [0.85, 0.527]; // ~0.85 — over AI_CONTEXT_FLOOR, under the threshold
const UNRELATED_VECTOR = [0, 1]; // 0 similarity

function makeItem(description: string): BoqItemWithBreakdown {
  return {
    id: randomUUID(),
    boqId: BOQ_ID,
    parentId: null,
    itemCode: null,
    description,
    category: null,
    unit: "m",
    quantity: 100,
    rate: null,
    amount: null,
    remarks: null,
    sortOrder: 0,
    rateBreakdown: null,
  } as unknown as BoqItemWithBreakdown;
}

class FakeBoqRepository implements Partial<IBoqRepository> {
  items: BoqItemWithBreakdown[] = [];
  enrichment = new Map<string, UpdateBoqItemEnrichmentData>();

  async findItemsByBoqId(): Promise<BoqItemWithBreakdown[]> {
    return this.items;
  }

  async updateItemEnrichment(id: string, data: UpdateBoqItemEnrichmentData): Promise<void> {
    this.enrichment.set(id, data);
  }
}

class FakeRatesRepository implements Partial<IHistoricalRatesRepository> {
  embedded: HistoricalRateVector[] = [];
  unembedded: { id: string; itemName: string }[] = [];

  async findUnembedded() {
    return this.unembedded;
  }

  async setEmbedding(id: string, embedding: number[]): Promise<void> {
    const pending = this.unembedded.find((rate) => rate.id === id);
    if (!pending) return;
    this.embedded.push({
      id,
      itemName: pending.itemName,
      unit: "m",
      rate: 152.5,
      category: "MATERIAL",
      embedding,
    });
    this.unembedded = this.unembedded.filter((rate) => rate.id !== id);
  }

  async findNearest(_businessId: string, queryVector: number[], limit: number): Promise<HistoricalRateMatch[]> {
    return this.embedded
      .map((rate) => ({
        id: rate.id,
        itemName: rate.itemName,
        unit: rate.unit,
        rate: rate.rate,
        category: rate.category,
        similarity: cosineSimilarity(queryVector, rate.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async findMany(_filters: ListHistoricalRatesFilters): Promise<HistoricalRateWithCreator[]> {
    return [];
  }

  async suggest(): Promise<HistoricalRateWithCreator[]> {
    return [];
  }

  async create(_data: CreateHistoricalRateData): Promise<HistoricalRateWithCreator> {
    throw new Error("not used");
  }
}

class FakeItemsRepository implements Partial<IItemsRepository> {
  confirmed = new Map<string, { hsnCode: string; gstRate: number }>();
  nearestConfirmedCategory: NearestConfirmedMatch[] = [];

  async findConfirmedHsn(_businessId: string, canonicalName: string) {
    return this.confirmed.get(canonicalName) ?? null;
  }

  async findNearestConfirmedMatch(): Promise<NearestConfirmedMatch[]> {
    return this.nearestConfirmedCategory;
  }
}

class FakeReferenceDataRepository implements Partial<IReferenceDataRepository> {
  nearestHsn: HsnCandidate[] = [];
  /** code -> GST rate, as curated in the lookup sheet. Absent means the sheet has no rate. */
  gstRates = new Map<string, number>();

  async findNearestHsn(): Promise<HsnCandidate[]> {
    return this.nearestHsn;
  }

  async findGstRateByCode(code: string): Promise<number | null> {
    return this.gstRates.get(code) ?? null;
  }
}

/** Empty by default — most tests don't care about category grounding, and (like the HSN
 * "no candidates" case) an empty leaf list must skip the LLM call entirely, not just return
 * nothing, so every test that doesn't opt in stays at exactly one generateJson call. */
class FakeCategoriesService implements Partial<CategoriesService> {
  leaves: { id: string; name: string; path: string; code: string | null }[] = [];

  async getLeaves() {
    return this.leaves;
  }

  async getPathMap() {
    return new Map(this.leaves.map((l) => [l.id, l.path]));
  }
}

/**
 * Stands in for the trained HSN classifier. `available` false is the real fresh-clone case: the
 * model is gitignored and rebuilt by ml/train, so the server has to work without it.
 */
class FakeClassifier {
  /** Off by default so each test says which path it exercises; the classifier tests opt in. */
  available = false;
  result: {
    headingCode: string | null;
    chapterCode: string | null;
    similarity: number;
    margin: number;
    confidence: number;
    abstained: boolean;
    alternatives: [];
  } = {
    headingCode: "7307",
    chapterCode: "73",
    similarity: 0.8,
    margin: 0.2,
    confidence: 0.6,
    abstained: false,
    alternatives: [],
  };
  calls: string[] = [];

  async isAvailable() {
    return this.available;
  }

  async classify(text: string) {
    this.calls.push(text);
    return this.result;
  }
}

function buildService() {
  const boqRepository = new FakeBoqRepository();
  const ratesRepository = new FakeRatesRepository();
  const itemsRepository = new FakeItemsRepository();
  const referenceDataRepository = new FakeReferenceDataRepository();
  const categoriesService = new FakeCategoriesService();
  const classifier = new FakeClassifier();
  const settingsService = {
    get: vi.fn(async (key: string) => (key === "CLASSIFIER_MIN_CONFIDENCE" ? 0.05 : 0.98)),
  } as unknown as SettingsService;
  const service = new BoqEnrichmentService(
    boqRepository as unknown as IBoqRepository,
    ratesRepository as unknown as IHistoricalRatesRepository,
    itemsRepository as unknown as IItemsRepository,
    referenceDataRepository as unknown as IReferenceDataRepository,
    settingsService,
    categoriesService as unknown as CategoriesService,
    classifier as unknown as IHsnClassifier,
  );
  return {
    service,
    boqRepository,
    ratesRepository,
    itemsRepository,
    referenceDataRepository,
    categoriesService,
    classifier,
  };
}

describe("BoqEnrichmentService", () => {
  beforeEach(() => {
    embedMock.mockReset();
    generateJsonMock.mockReset();
  });

  it("suggests the historical rate when wording, spec and unit all match", async () => {
    const { service, boqRepository, ratesRepository } = buildService();
    const item = makeItem("XLPE cable 4 core 16 sqmm");
    boqRepository.items = [item];
    ratesRepository.embedded = [
      {
        id: "rate-1",
        itemName: "XLPE Cable 4C x16",
        unit: "m",
        rate: 152.5,
        category: "MATERIAL",
        embedding: CABLE_VECTOR,
      },
    ];
    embedMock.mockResolvedValueOnce([NEAR_CABLE_VECTOR]);
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "XLPE Cable 4C x16",
      category: "Electrical",
      subcategory: "Cable",
      confidence: 0.8,
    });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const result = boqRepository.enrichment.get(item.id);
    expect(result?.normalizedName).toBe("XLPE Cable 4C x16");
    expect(result?.suggestedRate).toBe(152.5);
    expect(result?.aiSource).toBe("historical");
    expect(result?.aiRateSourceId).toBe("rate-1");
    // A measured near-exact match outranks anything the model claims about itself.
    expect(result?.aiConfidence).toBeGreaterThanOrEqual(0.95);
  });

  it("classifies with no rate when nothing in the rate history is close", async () => {
    const { service, boqRepository, ratesRepository } = buildService();
    const item = makeItem("Something the rate history has never seen");
    boqRepository.items = [item];
    ratesRepository.embedded = [
      {
        id: "rate-1",
        itemName: "XLPE Cable 4C x16",
        unit: "m",
        rate: 152.5,
        category: "MATERIAL",
        embedding: CABLE_VECTOR,
      },
    ];
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "Mystery Item",
      category: "Civil",
      subcategory: "Unknown",
      confidence: 0.99,
    });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const result = boqRepository.enrichment.get(item.id);
    expect(result?.normalizedName).toBe("Mystery Item");
    expect(result?.aiSource).toBe("llm");
    // Nothing cleared AI_MATCH_THRESHOLD — the LLM classifies, it must not invent a rate.
    expect(result?.suggestedRate).toBeNull();
    // Self-reported 0.99 must be clamped below the historical band.
    expect(result?.aiConfidence).toBe(0.9);
  });

  it("refuses the rate of a wrong-size item even at near-identical similarity", async () => {
    // The real trap: measured, bge-m3 scores "XLPE Cable 4C x16" vs "…x1.6" at 0.948 and
    // qwen3:4b calls "…x25" the same item. A ~10x wrong unit rate in a live bid is the cost
    // of getting this wrong, so the numeric-spec guard must veto regardless of similarity.
    const { service, boqRepository, ratesRepository } = buildService();
    const item = makeItem("XLPE Cable 4C x16");
    boqRepository.items = [item];
    ratesRepository.embedded = [
      {
        id: "wrong-size",
        itemName: "XLPE Cable 4C x1.6",
        unit: "m",
        rate: 24,
        category: "MATERIAL",
        embedding: CABLE_VECTOR,
      },
    ];
    // Above AI_MATCH_THRESHOLD — the similarity check alone would have taken this rate.
    embedMock.mockResolvedValueOnce([NEAR_CABLE_VECTOR]);
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "XLPE Cable 4C x16",
      category: "Electrical",
      subcategory: "Cable",
      confidence: 0.9,
    });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const result = boqRepository.enrichment.get(item.id);
    expect(result?.aiSource).toBe("llm");
    expect(result?.suggestedRate).toBeNull();
    expect(result?.aiRateSourceId).toBeNull();
  });

  it("refuses the rate of an identically-worded item priced in a different unit", async () => {
    const { service, boqRepository, ratesRepository } = buildService();
    const item = makeItem("XLPE Cable 4C x16"); // unit: "m"
    boqRepository.items = [item];
    ratesRepository.embedded = [
      {
        id: "wrong-unit",
        itemName: "XLPE Cable 4C x16",
        unit: "coil",
        rate: 15_000,
        category: "MATERIAL",
        embedding: CABLE_VECTOR,
      },
    ];
    embedMock.mockResolvedValueOnce([NEAR_CABLE_VECTOR]);
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "XLPE Cable 4C x16",
      category: "Electrical",
      subcategory: "Cable",
      confidence: 0.9,
    });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    expect(boqRepository.enrichment.get(item.id)?.suggestedRate).toBeNull();
  });

  it("never suggests a rate on the LLM path, however confident the model sounds", async () => {
    const { service, boqRepository, ratesRepository } = buildService();
    const item = makeItem("XLPE cable, 4 core, unusual spec");
    boqRepository.items = [item];
    ratesRepository.embedded = [
      {
        id: "rate-1",
        itemName: "XLPE Cable 4C x16",
        unit: "m",
        rate: 152.5,
        category: "MATERIAL",
        embedding: CABLE_VECTOR,
      },
    ];
    embedMock.mockResolvedValueOnce([SIMILAR_CABLE_VECTOR]);
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "XLPE Cable 4C",
      category: "Electrical",
      subcategory: "Cable",
      confidence: 0.99,
    });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const result = boqRepository.enrichment.get(item.id);
    expect(result?.aiSource).toBe("llm");
    expect(result?.suggestedRate).toBeNull();
    expect(result?.aiRateSourceId).toBeNull();
  });

  it("propagates ServiceUnavailableError when Ollama is down so the worker can no-op", async () => {
    const { service, boqRepository } = buildService();
    boqRepository.items = [makeItem("XLPE cable")];
    embedMock.mockRejectedValueOnce(new ServiceUnavailableError("Ollama not reachable"));

    await expect(service.enrichBoq(BOQ_ID, BUSINESS_ID)).rejects.toThrow(ServiceUnavailableError);
    expect(boqRepository.enrichment.size).toBe(0);
  });

  it("embeds historical rates lazily on first use", async () => {
    const { service, boqRepository, ratesRepository } = buildService();
    const item = makeItem("XLPE cable 4 core 16 sqmm");
    boqRepository.items = [item];
    ratesRepository.unembedded = [{ id: "rate-1", itemName: "XLPE Cable 4C x16" }];

    embedMock
      .mockResolvedValueOnce([CABLE_VECTOR]) // backfill of the historical rate
      .mockResolvedValueOnce([NEAR_CABLE_VECTOR]); // the BOQ item itself
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "XLPE Cable 4C x16",
      category: "Electrical",
      subcategory: "Cable",
      confidence: 0.8,
    });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    expect(ratesRepository.unembedded).toHaveLength(0);
    expect(boqRepository.enrichment.get(item.id)?.aiSource).toBe("historical");
  });

  it("skips section headers that carry no quantity or rate", async () => {
    const { service, boqRepository } = buildService();
    const header = makeItem("SECTION A — ELECTRICAL WORKS");
    header.quantity = null;
    header.rate = null;
    boqRepository.items = [header];

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    expect(embedMock).not.toHaveBeenCalled();
    expect(boqRepository.enrichment.size).toBe(0);
  });

  it("takes the GST rate from the matched HSN heading, not from the model", async () => {
    const { service, boqRepository, referenceDataRepository } = buildService();
    const item = makeItem("PORTLAND CEMENT OPC 43 GRADE 50KG BAG");
    boqRepository.items = [item];
    referenceDataRepository.nearestHsn = [
      { code: "2523", description: "PORTLAND CEMENT, ALUMINOUS CEMENT", similarity: 0.9 },
    ];
    referenceDataRepository.gstRates.set("2523", 5);
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock
      .mockResolvedValueOnce({ normalizedName: "OPC 43 Grade Cement", confidence: 0.8 })
      .mockResolvedValueOnce({ hsnCode: "2523" });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const result = boqRepository.enrichment.get(item.id);
    expect(result?.suggestedGstRate).toBe(5);
    expect(result?.gstRate).toBe(5);
  });

  it("leaves the GST rate unset when the lookup sheet has no rate for the matched heading", async () => {
    // An invented tax rate that looks plausible is worse than an empty field, because nobody goes
    // back to check it. The old code asked the model for a percentage here.
    const { service, boqRepository, referenceDataRepository } = buildService();
    const item = makeItem("PORTLAND CEMENT OPC 43 GRADE 50KG BAG");
    boqRepository.items = [item];
    referenceDataRepository.nearestHsn = [
      { code: "2523", description: "PORTLAND CEMENT, ALUMINOUS CEMENT", similarity: 0.9 },
    ];
    // no rate seeded for 2523
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock
      .mockResolvedValueOnce({ normalizedName: "OPC 43 Grade Cement", confidence: 0.8 })
      .mockResolvedValueOnce({ hsnCode: "2523" });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const result = boqRepository.enrichment.get(item.id);
    expect(result?.suggestedGstRate).toBeNull();
    expect(result).not.toHaveProperty("gstRate");
  });

  it("prefers a human-confirmed catalog rate over the sheet's rate for the same heading", async () => {
    const { service, boqRepository, itemsRepository, referenceDataRepository } = buildService();
    const item = makeItem("XLPE cable 4 core 16 sqmm");
    boqRepository.items = [item];
    itemsRepository.confirmed.set("XLPE cable 4 core 16 sqmm", { hsnCode: "8544", gstRate: 12 });
    referenceDataRepository.gstRates.set("8544", 18);
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock.mockResolvedValueOnce({ normalizedName: "XLPE Cable 4C x16", confidence: 0.8 });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    expect(boqRepository.enrichment.get(item.id)?.gstRate).toBe(12);
  });

  it("suggests a fresh (non-catalog) HSN match but never auto-fills the real hsnCode field", async () => {
    const { service, boqRepository, referenceDataRepository } = buildService();
    const item = makeItem("PORTLAND CEMENT OPC 43 GRADE 50KG BAG");
    boqRepository.items = [item];
    referenceDataRepository.nearestHsn = [
      { code: "2523", description: "PORTLAND CEMENT, ALUMINOUS CEMENT, SLAG CEMENT", similarity: 0.9 },
    ];
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock
      .mockResolvedValueOnce({
        normalizedName: "OPC 43 Grade Cement",
        category: "Civil",
        subcategory: "Cement",
        confidence: 0.8,
        hsnCode: null,
        gstRatePercent: 18,
      })
      .mockResolvedValueOnce({ hsnCode: "2523" });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const result = boqRepository.enrichment.get(item.id);
    expect(result?.suggestedHsnCode).toBe("2523");
    expect(result).not.toHaveProperty("hsnCode");
  });

  it("rejects an HSN code the model returns that wasn't in the offered candidate list", async () => {
    const { service, boqRepository, referenceDataRepository } = buildService();
    const item = makeItem("PORTLAND CEMENT OPC 43 GRADE 50KG BAG");
    boqRepository.items = [item];
    referenceDataRepository.nearestHsn = [
      { code: "2523", description: "PORTLAND CEMENT, ALUMINOUS CEMENT, SLAG CEMENT", similarity: 0.9 },
    ];
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock
      .mockResolvedValueOnce({
        normalizedName: "OPC 43 Grade Cement",
        category: "Civil",
        subcategory: "Cement",
        confidence: 0.8,
        hsnCode: null,
        gstRatePercent: 18,
      })
      // The model hallucinates a code that was never offered — must be rejected, not stored.
      .mockResolvedValueOnce({ hsnCode: "9999" });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    expect(boqRepository.enrichment.get(item.id)?.suggestedHsnCode).toBeNull();
  });

  it("suggests nothing when ANN retrieval finds no HSN candidates at all", async () => {
    const { service, boqRepository, referenceDataRepository } = buildService();
    referenceDataRepository.nearestHsn = [];
    const item = makeItem("SOME ITEM WITH NO CLEAN HSN ANALOG");
    boqRepository.items = [item];
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "Unusual Item",
      category: "Other",
      subcategory: null,
      confidence: 0.5,
      hsnCode: null,
      gstRatePercent: 18,
    });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const result = boqRepository.enrichment.get(item.id);
    expect(result?.suggestedHsnCode).toBeNull();
    // No second generateJson call for the HSN pick — there was nothing to offer it.
    expect(generateJsonMock).toHaveBeenCalledTimes(1);
  });

  it("suggests nothing when the model itself says none of the offered candidates fit", async () => {
    const { service, boqRepository, referenceDataRepository } = buildService();
    referenceDataRepository.nearestHsn = [
      { code: "7307", description: "TUBE OR PIPE FITTINGS, OF IRON OR STEEL", similarity: 0.7 },
    ];
    const item = makeItem("SOME ITEM WITH NO CLEAN HSN ANALOG");
    boqRepository.items = [item];
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock
      .mockResolvedValueOnce({
        normalizedName: "Unusual Item",
        category: "Other",
        subcategory: null,
        confidence: 0.5,
        hsnCode: null,
        gstRatePercent: 18,
      })
      .mockResolvedValueOnce({ hsnCode: null });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    expect(boqRepository.enrichment.get(item.id)?.suggestedHsnCode).toBeNull();
  });

  it("prefers a confirmed catalog HSN over the LLM's own guess for the same item, and auto-fills that too", async () => {
    const { service, boqRepository, itemsRepository } = buildService();
    const item = makeItem("XLPE cable 4 core 16 sqmm");
    boqRepository.items = [item];
    // Keyed on the canonical name the enrichment loop derives (no normalizedName yet, so it's
    // the collapsed description) — same identity rule items.service.ts's backfill uses.
    itemsRepository.confirmed.set("XLPE cable 4 core 16 sqmm", { hsnCode: "854430", gstRate: 28 });
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "XLPE Cable 4C x16",
      category: "Electrical",
      subcategory: "Cable",
      confidence: 0.8,
      hsnCode: "9999", // conflicting guess — the catalog match must win
      gstRatePercent: 5,
    });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const result = boqRepository.enrichment.get(item.id);
    expect(result?.suggestedHsnCode).toBe("854430");
    expect(result?.suggestedGstRate).toBe(28);
    expect(result?.hsnCode).toBe("854430");
    expect(result?.gstRate).toBe(28);
  });

  it("never overwrites an already human-confirmed hsnCode/gstRate on re-enrichment", async () => {
    const { service, boqRepository, referenceDataRepository } = buildService();
    const item = { ...makeItem("XLPE cable 4 core 16 sqmm"), hsnCodeConfirmed: true } as BoqItemWithBreakdown;
    boqRepository.items = [item];
    referenceDataRepository.nearestHsn = [
      { code: "8544", description: "Insulated wire, cable and other conductors", similarity: 0.85 },
    ];
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock
      .mockResolvedValueOnce({
        normalizedName: "XLPE Cable 4C x16",
        category: "Electrical",
        subcategory: "Cable",
        confidence: 0.8,
        hsnCode: null,
        gstRatePercent: 5,
      })
      .mockResolvedValueOnce({ hsnCode: "8544" });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const result = boqRepository.enrichment.get(item.id);
    // The suggestion record still updates (provenance/audit trail)...
    expect(result?.suggestedHsnCode).toBe("8544");
    // ...but the real, human-confirmed fields are never touched — the key must be absent
    // entirely (not null/undefined-valued), since that's what makes Prisma skip the column.
    expect(result).not.toHaveProperty("hsnCode");
    expect(result).not.toHaveProperty("gstRate");
  });

  it("resolves a known steel pipe-fitting description deterministically, skipping the ANN/LLM HSN pick", async () => {
    const { service, boqRepository, referenceDataRepository } = buildService();
    const item = makeItem("SOCKET MATERIAL : MILD STEEL SIZE : 2IN MEDIUM QUALITY");
    boqRepository.items = [item];
    // Deliberately wrong candidates — if the ANN/LLM path ran, this is what it would pick from.
    referenceDataRepository.nearestHsn = [
      {
        code: "8547",
        description: "INSULATING FITTINGS FOR ELECTRICAL MACHINES",
        similarity: 0.9,
      },
    ];
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "Pipe Socket 2in",
      category: "Plumbing",
      subcategory: "Fittings",
      confidence: 0.8,
      hsnCode: null,
      gstRatePercent: 18,
    });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const result = boqRepository.enrichment.get(item.id);
    expect(result?.suggestedHsnCode).toBe("7307");
    // Only the classification call ran — the keyword match short-circuits the HSN pick call.
    expect(generateJsonMock).toHaveBeenCalledTimes(1);
  });


  describe("item category from the tariff heading", () => {
    // The taxonomy IS the tariff, so the resolved HSN code already names the category. There is no
    // separate category classification to disagree with it.
    const springLeaf = {
      id: "cat-7320",
      name: "Springs and leaves for springs",
      path: "Articles of iron or steel > Springs and leaves for springs",
      code: "7320",
    };

    it("derives category and subcategory from the matched HSN heading", async () => {
      const { service, boqRepository, categoriesService, referenceDataRepository } = buildService();
      const item = makeItem("WASHER TYPE : DISC SPRING MATERIAL : SPRING STEEL 51CRV4");
      boqRepository.items = [item];
      categoriesService.leaves = [springLeaf];
      referenceDataRepository.gstRates.set("7320", 18);
      embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
      // Only the naming call — the keyword rule resolves 7320 without an HSN pick, and the category
      // now needs no LLM call of its own.
      generateJsonMock.mockResolvedValueOnce({ normalizedName: "Disc Spring Washer", confidence: 0.8 });

      await service.enrichBoq(BOQ_ID, BUSINESS_ID);

      const result = boqRepository.enrichment.get(item.id);
      expect(result?.suggestedHsnCode).toBe("7320");
      expect(result?.aiCategory).toBe("Articles of iron or steel");
      expect(result?.aiSubcategory).toBe("Springs and leaves for springs");
      expect(generateJsonMock).toHaveBeenCalledTimes(1);
    });

    it("keeps the category and the HSN code in step — they come from the same decision", async () => {
      const { service, boqRepository, categoriesService, referenceDataRepository } = buildService();
      const item = makeItem("SOCKET MATERIAL : MILD STEEL : GALVANIZED IS:1239 SIZE : 15MM");
      boqRepository.items = [item];
      categoriesService.leaves = [
        springLeaf,
        {
          id: "cat-7307",
          name: "Tube or pipe fittings",
          path: "Articles of iron or steel > Tube or pipe fittings",
          code: "7307",
        },
      ];
      referenceDataRepository.gstRates.set("7307", 18);
      embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
      generateJsonMock.mockResolvedValueOnce({ normalizedName: "MS Socket 15mm", confidence: 0.8 });

      await service.enrichBoq(BOQ_ID, BUSINESS_ID);

      const result = boqRepository.enrichment.get(item.id);
      expect(result?.suggestedHsnCode).toBe("7307");
      expect(result?.aiSubcategory).toBe("Tube or pipe fittings");
    });

    it("suggests no category when no HSN code could be resolved", async () => {
      const { service, boqRepository, categoriesService, referenceDataRepository } = buildService();
      const item = makeItem("SOME ITEM WITH NO CLEAN HSN ANALOG");
      boqRepository.items = [item];
      categoriesService.leaves = [springLeaf];
      referenceDataRepository.nearestHsn = []; // nothing to offer, so no code
      embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
      generateJsonMock.mockResolvedValueOnce({ normalizedName: "Unusual Item", confidence: 0.5 });

      await service.enrichBoq(BOQ_ID, BUSINESS_ID);

      const result = boqRepository.enrichment.get(item.id);
      expect(result?.suggestedHsnCode).toBeNull();
      expect(result?.aiCategory).toBeNull();
      expect(result?.aiSubcategory).toBeNull();
    });

    it("suggests no category when the resolved code is not in the taxonomy", async () => {
      // e.g. the sheet deactivated that chapter, so it is no longer a leaf anyone can be put in.
      const { service, boqRepository, categoriesService, referenceDataRepository } = buildService();
      const item = makeItem("PORTLAND CEMENT OPC 43 GRADE 50KG BAG");
      boqRepository.items = [item];
      categoriesService.leaves = [springLeaf]; // no 2523
      referenceDataRepository.nearestHsn = [
        { code: "2523", description: "PORTLAND CEMENT", similarity: 0.9 },
      ];
      embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
      generateJsonMock
        .mockResolvedValueOnce({ normalizedName: "OPC 43 Grade Cement", confidence: 0.8 })
        .mockResolvedValueOnce({ hsnCode: "2523" });

      await service.enrichBoq(BOQ_ID, BUSINESS_ID);

      const result = boqRepository.enrichment.get(item.id);
      expect(result?.suggestedHsnCode).toBe("2523");
      expect(result?.aiCategory).toBeNull();
    });

    it("leaves subcategory null for a top-level leaf with no parent in its path", async () => {
      const { service, boqRepository, categoriesService, referenceDataRepository } = buildService();
      const item = makeItem("SOCKET MATERIAL : MILD STEEL IS:1239 SIZE : 15MM");
      boqRepository.items = [item];
      categoriesService.leaves = [
        { id: "cat-7307", name: "Tube or pipe fittings", path: "Tube or pipe fittings", code: "7307" },
      ];
      referenceDataRepository.gstRates.set("7307", 18);
      embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
      generateJsonMock.mockResolvedValueOnce({ normalizedName: "MS Socket", confidence: 0.5 });

      await service.enrichBoq(BOQ_ID, BUSINESS_ID);

      const result = boqRepository.enrichment.get(item.id);
      expect(result?.aiCategory).toBe("Tube or pipe fittings");
      expect(result?.aiSubcategory).toBeNull();
    });
  });

  it("takes the HSN code from the trained classifier, without asking the model to pick one", async () => {
    // The whole point of stage 4. The old path retrieved candidates by embedding and had the LLM
    // choose among them, which scored 0 correct out of 22 on real purchase-order lines.
    const { service, boqRepository, classifier, referenceDataRepository } = buildService();
    classifier.available = true;
    const item = makeItem("SOCKET MATERIAL : MILD STEEL, IS:1239");
    boqRepository.items = [item];
    referenceDataRepository.nearestHsn = [
      { code: "9999", description: "SOMETHING ELSE ENTIRELY", similarity: 0.9 },
    ];
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "MS Socket 15mm",
      confidence: 0.8,
      hsnCode: null,
    });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    expect(classifier.calls).toContain("SOCKET MATERIAL : MILD STEEL, IS:1239");
    expect(boqRepository.enrichment.get(item.id)?.suggestedHsnCode).toBe("7307");
    // One call, for naming. The HSN pick is no longer the model's to make.
    expect(generateJsonMock).toHaveBeenCalledTimes(1);
  });

  it("suggests nothing when the classifier abstains, rather than falling back to a guess", async () => {
    const { service, boqRepository, classifier, referenceDataRepository } = buildService();
    classifier.available = true;
    classifier.result = {
      headingCode: null,
      chapterCode: null,
      similarity: 0.4,
      margin: 0.001,
      confidence: 0.004,
      abstained: true,
      alternatives: [],
    };
    const item = makeItem("SOMETHING NOBODY HAS CLASSIFIED BEFORE");
    boqRepository.items = [item];
    referenceDataRepository.nearestHsn = [
      { code: "2523", description: "PORTLAND CEMENT", similarity: 0.9 },
    ];
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock.mockResolvedValueOnce({ normalizedName: "Mystery", confidence: 0.5, hsnCode: null });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const result = boqRepository.enrichment.get(item.id);
    expect(result?.suggestedHsnCode).toBeNull();
    expect(result?.aiCategory).toBeNull();
  });

  it("falls back to the old retrieval path when no trained model is installed", async () => {
    // The model is gitignored and rebuilt by ml/train, so a fresh clone has none. Enrichment must
    // still do what it did before rather than stop suggesting anything at all.
    const { service, boqRepository, classifier, referenceDataRepository } = buildService();
    classifier.available = false; // explicit: this test is about exactly this condition
    const item = makeItem("PORTLAND CEMENT OPC 43 GRADE 50KG BAG");
    boqRepository.items = [item];
    referenceDataRepository.nearestHsn = [
      { code: "2523", description: "PORTLAND CEMENT, ALUMINOUS CEMENT, SLAG CEMENT", similarity: 0.9 },
    ];
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock
      .mockResolvedValueOnce({ normalizedName: "OPC 43 Grade Cement", confidence: 0.8, hsnCode: null })
      .mockResolvedValueOnce({ hsnCode: "2523" });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    expect(classifier.calls).toHaveLength(0);
    expect(boqRepository.enrichment.get(item.id)?.suggestedHsnCode).toBe("2523");
  });

  it("derives the category from the classifier's heading, so the two can never disagree", async () => {
    const { service, boqRepository, classifier, categoriesService } = buildService();
    classifier.available = true;
    categoriesService.leaves = [
      {
        id: randomUUID(),
        name: "Springs and leaves for springs",
        path: "Articles of iron or steel > Springs and leaves for springs",
        code: "7320",
      },
    ];
    classifier.result = {
      headingCode: "7320",
      chapterCode: "73",
      similarity: 0.9,
      margin: 0.3,
      confidence: 0.7,
      abstained: false,
      alternatives: [],
    };
    const item = makeItem("WASHER TYPE : DISC SPRING, SPRING STEEL 51CRV4");
    boqRepository.items = [item];
    embedMock.mockResolvedValueOnce([UNRELATED_VECTOR]);
    generateJsonMock.mockResolvedValueOnce({
      normalizedName: "Disc spring washer",
      confidence: 0.8,
      hsnCode: null,
    });

    await service.enrichBoq(BOQ_ID, BUSINESS_ID);

    const result = boqRepository.enrichment.get(item.id);
    expect(result?.suggestedHsnCode).toBe("7320");
    expect(result?.aiCategory).toBe("Articles of iron or steel");
  });
});
