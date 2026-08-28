import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HistoricalRatesRepository } from "../rates.repository.js";

describe("findNearest (HistoricalRate ANN, integration)", () => {
  const repository = new HistoricalRatesRepository(prisma);
  let businessId: string;
  let userId: string;
  const rateIds: string[] = [];

  async function insertEmbeddedRate(itemName: string, vector: number[]): Promise<string> {
    const id = randomUUID();
    await prisma.historicalRate.create({
      data: {
        id,
        businessId,
        category: "MATERIAL",
        itemName,
        unit: "nos",
        rate: 100,
        effectiveDate: new Date(),
        createdById: userId,
        embedding: vector,
        embeddedAt: new Date(),
      },
    });
    const vectorLiteral = `[${vector.join(",")}]`;
    await prisma.$executeRaw`UPDATE historical_rates SET "embeddingVector" = ${vectorLiteral}::vector WHERE id = ${id}`;
    rateIds.push(id);
    return id;
  }

  beforeAll(async () => {
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: "ANN Rate Test Business", code: `ANNR${randomUUID().slice(0, 8)}` },
    });
    businessId = business.id;
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `ann-rate-${randomUUID()}@example.com`,
        passwordHash: "not-a-real-hash",
        firstName: "Ann",
        lastName: "Tester",
        isActive: true,
        isEmailVerified: true,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.historicalRate.deleteMany({ where: { id: { in: rateIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it("ranks nearest rate first, ordered by descending similarity", async () => {
    const dims = 1024;
    const near = new Array(dims).fill(0);
    near[0] = 1;
    const mid = new Array(dims).fill(0);
    mid[0] = 0.9;
    mid[1] = Math.sqrt(1 - 0.81);
    const far = new Array(dims).fill(0);
    far[1] = 1;
    const query = new Array(dims).fill(0);
    query[0] = 1;

    await insertEmbeddedRate("XLPE Cable 4C x16", near);
    await insertEmbeddedRate("XLPE Cable 4C x25", mid);
    await insertEmbeddedRate("PVC Pipe 100mm", far);

    const results = await repository.findNearest(businessId, query, 10);

    expect(results).toHaveLength(3);
    expect(results[0]?.itemName).toBe("XLPE Cable 4C x16");
    expect(results[0]?.similarity).toBeCloseTo(1, 5);
    expect(results[2]?.itemName).toBe("PVC Pipe 100mm");
  });

  // setEmbedding writes embedding/embeddedAt (Prisma) and embeddingVector (raw SQL) in one
  // $transaction — a partial write would leave embeddedAt set with embeddingVector NULL, which
  // findUnembedded() would never revisit. Asserts both columns land, and that a bad-dimension
  // vector rolls the whole pair back instead of half-committing.
  it("setEmbedding writes both embedding columns atomically", async () => {
    const id = randomUUID();
    await prisma.historicalRate.create({
      data: {
        id,
        businessId,
        category: "MATERIAL",
        itemName: "Atomic Write Probe",
        unit: "nos",
        rate: 100,
        effectiveDate: new Date(),
        createdById: userId,
      },
    });
    rateIds.push(id);

    const vector = new Array(1024).fill(0);
    vector[0] = 1;
    await repository.setEmbedding(id, vector);

    const [row] = await prisma.$queryRaw<{ embeddedAt: Date | null; hasVector: boolean }[]>`
      SELECT "embeddedAt", "embeddingVector" IS NOT NULL AS "hasVector"
      FROM historical_rates WHERE id = ${id}
    `;
    expect(row?.embeddedAt).not.toBeNull();
    expect(row?.hasVector).toBe(true);

    // Wrong dimensions -> the ::vector cast throws; embeddedAt must NOT have advanced.
    const before = row?.embeddedAt;
    await expect(repository.setEmbedding(id, [0.1, 0.2, 0.3])).rejects.toThrow();
    const after = await prisma.historicalRate.findUnique({ where: { id }, select: { embeddedAt: true } });
    expect(after?.embeddedAt?.getTime()).toBe(before?.getTime());
  });

  it("scopes results to the given business", async () => {
    const otherBusiness = await prisma.business.create({
      data: { id: randomUUID(), name: "Other ANN Business", code: `OTHR${randomUUID().slice(0, 8)}` },
    });
    const dims = 1024;
    const query = new Array(dims).fill(0);
    query[0] = 1;

    const results = await repository.findNearest(otherBusiness.id, query, 10);
    expect(results).toHaveLength(0);

    await prisma.business.deleteMany({ where: { id: otherBusiness.id } });
  });
});
