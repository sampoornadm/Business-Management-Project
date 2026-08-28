import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ItemsRepository } from "../items.repository.js";

describe("findNearestConfirmedMatch (Item ANN, integration)", () => {
  const repository = new ItemsRepository(prisma);
  let businessId: string;
  let categoryId: string;
  const itemIds: string[] = [];

  async function insertConfirmedItem(canonicalName: string, vector: number[] | null): Promise<string> {
    const id = randomUUID();
    await prisma.item.create({
      data: {
        id,
        businessId,
        canonicalName,
        unit: "nos",
        categoryId,
        categoryConfirmed: true,
        embedding: vector ?? [],
        embeddedAt: vector ? new Date() : null,
      },
    });
    if (vector) {
      const vectorLiteral = `[${vector.join(",")}]`;
      await prisma.$executeRaw`UPDATE items SET "embeddingVector" = ${vectorLiteral}::vector WHERE id = ${id}`;
    }
    itemIds.push(id);
    return id;
  }

  beforeAll(async () => {
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: "ANN Item Test Business", code: `ANNI${randomUUID().slice(0, 8)}` },
    });
    businessId = business.id;
    const category = await prisma.category.create({
      data: { id: randomUUID(), name: "ANN Test Category" },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it("excludes the target item itself even at identical similarity", async () => {
    const dims = 1024;
    const vector = new Array(dims).fill(0);
    vector[0] = 1;

    const selfId = await insertConfirmedItem("Self Item", vector);
    await insertConfirmedItem("Sibling Item", vector);

    const results = await repository.findNearestConfirmedMatch(businessId, selfId, vector, 20);

    expect(results.some((r) => r.id === selfId)).toBe(false);
    expect(results.some((r) => r.canonicalName === "Sibling Item")).toBe(true);
  });

  it("excludes items with no embeddingVector and respects the limit", async () => {
    const dims = 1024;
    const vector = new Array(dims).fill(0);
    vector[0] = 1;

    await insertConfirmedItem("Unembedded Item", null);
    const excludeId = randomUUID();

    const results = await repository.findNearestConfirmedMatch(businessId, excludeId, vector, 1);

    expect(results.every((r) => r.canonicalName !== "Unembedded Item")).toBe(true);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});
