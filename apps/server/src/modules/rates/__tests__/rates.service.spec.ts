import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import type {
  CreateHistoricalRateData,
  HistoricalRateWithCreator,
  IHistoricalRatesRepository,
  ListHistoricalRatesFilters,
} from "../rates.repository.js";
import { RatesService } from "../rates.service.js";

function buildRate(overrides: Partial<HistoricalRateWithCreator> = {}): HistoricalRateWithCreator {
  return {
    id: randomUUID(),
    category: "MATERIAL",
    itemName: "Portland Cement",
    unit: "bag",
    rate: 380,
    location: "Pune",
    effectiveDate: new Date("2026-01-01"),
    sourceTenderId: null,
    notes: null,
    createdById: randomUUID(),
    createdBy: { id: randomUUID(), firstName: "Emma", lastName: "Estimator" },
    createdAt: new Date(),
    ...overrides,
  } as HistoricalRateWithCreator;
}

class FakeHistoricalRatesRepository implements IHistoricalRatesRepository {
  rates: HistoricalRateWithCreator[] = [];

  async findMany(filters: ListHistoricalRatesFilters): Promise<HistoricalRateWithCreator[]> {
    return this.rates.filter((rate) => {
      if (filters.category && rate.category !== filters.category) return false;
      if (filters.itemName && !rate.itemName.toLowerCase().includes(filters.itemName.toLowerCase())) {
        return false;
      }
      return true;
    });
  }

  // businessId is ignored here — the fake stands in for the real (Postgres-
  // backed) repository in unit tests that don't exercise cross-business
  // isolation; that's covered by the integration spec instead.
  async suggest(
    category: string,
    itemName: string,
    limit: number,
    _businessId?: string,
  ): Promise<HistoricalRateWithCreator[]> {
    return this.rates
      .filter(
        (rate) =>
          rate.category === category && rate.itemName.toLowerCase().includes(itemName.toLowerCase()),
      )
      .sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime())
      .slice(0, limit);
  }

  async create(data: CreateHistoricalRateData): Promise<HistoricalRateWithCreator> {
    const rate = buildRate({ id: randomUUID(), ...data });
    this.rates.push(rate);
    return rate;
  }
}

describe("RatesService", () => {
  let repository: FakeHistoricalRatesRepository;
  let service: RatesService;
  const businessId = randomUUID();

  beforeEach(() => {
    repository = new FakeHistoricalRatesRepository();
    service = new RatesService(repository);
  });

  it("creates a historical rate", async () => {
    const dto = await service.create({
      category: "MATERIAL",
      itemName: "Portland Cement",
      unit: "bag",
      rate: 380,
      effectiveDate: new Date("2026-01-01"),
      businessId,
      createdById: randomUUID(),
    });
    expect(dto.itemName).toBe("Portland Cement");
    expect(dto.rate).toBe(380);
  });

  it("filters by category and itemName", async () => {
    await repository.create({
      category: "MATERIAL",
      itemName: "Portland Cement",
      unit: "bag",
      rate: 380,
      effectiveDate: new Date("2026-01-01"),
      businessId,
      createdById: randomUUID(),
    });
    await repository.create({
      category: "LABOR",
      itemName: "Mason",
      unit: "day",
      rate: 900,
      effectiveDate: new Date("2026-01-01"),
      businessId,
      createdById: randomUUID(),
    });

    const results = await service.list({ category: "MATERIAL", businessId });
    expect(results).toHaveLength(1);
    expect(results[0]!.itemName).toBe("Portland Cement");
  });

  it("suggests the most recent matching rates, capped at the limit", async () => {
    await repository.create({
      category: "MATERIAL",
      itemName: "Steel TMT Bar",
      unit: "kg",
      rate: 60,
      effectiveDate: new Date("2025-06-01"),
      businessId,
      createdById: randomUUID(),
    });
    await repository.create({
      category: "MATERIAL",
      itemName: "Steel TMT Bar",
      unit: "kg",
      rate: 65,
      effectiveDate: new Date("2026-01-01"),
      businessId,
      createdById: randomUUID(),
    });

    const results = await service.suggest("MATERIAL", "steel", 1, businessId);
    expect(results).toHaveLength(1);
    expect(results[0]!.rate).toBe(65);
  });
});
