import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = fileURLToPath(
  new URL(
    "../../../../../../packages/database/prisma/migrations/20261111230000_rate_finalization_backfill/migration.sql",
    import.meta.url,
  ),
);

/** Runs the migration's statements one by one (Postgres prepared statements take one at a time). */
async function runBackfill(): Promise<void> {
  const sql = readFileSync(MIGRATION, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  for (const statement of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(statement);
  }
}

describe("rate finalization backfill migration (integration)", () => {
  let businessId: string;
  let userId: string;
  const vendorIds: string[] = [];
  let itemId: string;
  let closedQuotes: { selected: string; losing: string; regretted: string };
  let openQuoteId: string;
  let legacyRowId: string;

  beforeAll(async () => {
    businessId = (
      await prisma.business.create({
        data: { id: randomUUID(), name: `Backfill ${randomUUID()}`, code: `BF${randomUUID().slice(0, 6)}` },
      })
    ).id;
    userId = (
      await prisma.user.create({
        data: {
          id: randomUUID(),
          email: `backfill-${randomUUID()}@example.com`,
          firstName: "Back",
          lastName: "Fill",
          passwordHash: "not-a-real-hash",
          isEmailVerified: true,
        },
      })
    ).id;
    for (const name of ["BF Vendor A", "BF Vendor B", "BF Vendor C"]) {
      vendorIds.push(
        (await prisma.vendor.create({ data: { id: randomUUID(), name, category: "MATERIAL_SUPPLIER", createdById: userId } })).id,
      );
    }
    itemId = (await prisma.item.create({ data: { id: randomUUID(), businessId, canonicalName: "bf cement", unit: "bag" } })).id;

    async function rfqWithItem(status: "CLOSED" | "SENT") {
      const rfq = await prisma.rfq.create({
        data: { id: randomUUID(), businessId, title: `BF ${status}`, status, createdById: userId },
      });
      return prisma.rfqItem.create({
        data: { id: randomUUID(), rfqId: rfq.id, description: "BF Cement", unit: "bag", quantity: 10, itemId },
      });
    }

    const closedItem = await rfqWithItem("CLOSED");
    const quote = (vendorId: string, rate: number | null, extra: object = {}) =>
      prisma.rfqQuote.create({ data: { id: randomUUID(), rfqItemId: closedItem.id, vendorId, rate, ...extra } });
    const selected = await quote(vendorIds[0]!, 380, { isSelected: true });
    const losing = await quote(vendorIds[1]!, 420);
    const regretted = await quote(vendorIds[2]!, null, { regretted: true });
    closedQuotes = { selected: selected.id, losing: losing.id, regretted: regretted.id };

    // A pre-branch "Push rates to tender" row: selected quote, no itemId, default since cleared.
    legacyRowId = (
      await prisma.historicalRate.create({
        data: {
          id: randomUUID(),
          businessId,
          category: "MATERIAL",
          itemName: "BF Cement",
          unit: "bag",
          rate: 380,
          effectiveDate: new Date(),
          vendorId: vendorIds[0]!,
          rfqQuoteId: selected.id,
          isDefault: false,
          createdById: userId,
        },
      })
    ).id;

    const openItem = await rfqWithItem("SENT");
    openQuoteId = (
      await prisma.rfqQuote.create({ data: { id: randomUUID(), rfqItemId: openItem.id, vendorId: vendorIds[0]!, rate: 370 } })
    ).id;
  });

  afterAll(async () => {
    await prisma.historicalRate.deleteMany({ where: { businessId } });
    await prisma.rfq.deleteMany({ where: { businessId } });
    await prisma.item.deleteMany({ where: { businessId } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it("gives every priced quote on a closed RFQ a VENDOR row for its item, default = selected", async () => {
    await runBackfill();

    const rows = await prisma.historicalRate.findMany({ where: { businessId }, orderBy: { rate: "asc" } });
    expect(rows.map((r) => [r.rfqQuoteId, r.rate, r.isDefault, r.kind, r.itemId])).toEqual([
      [closedQuotes.selected, 380, true, "VENDOR", itemId],
      [closedQuotes.losing, 420, false, "VENDOR", itemId],
    ]);
    // The legacy pushed row was adopted (itemId set, default restored), not duplicated.
    expect(rows[0]!.id).toBe(legacyRowId);
    expect(rows.some((r) => r.rfqQuoteId === closedQuotes.regretted || r.rfqQuoteId === openQuoteId)).toBe(false);
  });

  it("is idempotent", async () => {
    await runBackfill();

    expect(await prisma.historicalRate.count({ where: { businessId } })).toBe(2);
  });
});
