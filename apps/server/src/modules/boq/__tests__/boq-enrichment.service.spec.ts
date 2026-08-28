import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceUnavailableError } from "../../../core/errors/HttpErrors.js";
import { cosineSimilarity } from "../../../shared/utils/math.js";
import type {
  CreateHistoricalRateData,
  HistoricalRateMatch,
  HistoricalRateVector,
  HistoricalRateWithCreator,
  IHistoricalRatesRepository,
  ListHistoricalRatesFilters,
} from "../../rates/rates.repository.js";
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

function buildService() {
  const boqRepository = new FakeBoqRepository();
  const ratesRepository = new FakeRatesRepository();
  const service = new BoqEnrichmentService(
    boqRepository as unknown as IBoqRepository,
    ratesRepository as unknown as IHistoricalRatesRepository,
  );
  return { service, boqRepository, ratesRepository };
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
    // Trade category comes from the LLM, never from HistoricalRate.category — that column is
    // a cost-type (MATERIAL/LABOR), a different taxonomy entirely.
    expect(result?.aiCategory).toBe("Electrical");
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
    expect(result?.aiCategory).toBe("Civil");
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
    expect(result?.aiCategory).toBe("Electrical");
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
});
