import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import {
  cleanupIntegrationTestUser,
  createIntegrationTestUser,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";

/**
 * Requires a real Postgres + Redis + MinIO reachable via .env.test
 * (`pnpm db:migrate` against the test database, `docker compose up`).
 */
describe("RFQ quote sheet export/import (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let token: string;
  let userId: string;
  let vendorId: string;
  let rfqId: string;

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    token = testUser.accessToken;
    userId = testUser.userId;

    const vendor = await prisma.vendor.create({
      data: {
        id: randomUUID(),
        name: `Quote Vendor ${randomUUID().slice(0, 8)}`,
        category: "MATERIAL_SUPPLIER",
        createdById: userId,
      },
    });
    vendorId = vendor.id;

    const created = await request(app)
      .post("/api/v1/rfqs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Quote Sheet Integration RFQ",
        items: [
          { description: "XLPE Cable 4C x16", unit: "m", quantity: 100 },
          { description: "XLPE Cable 4C x25", unit: "m", quantity: 50 },
        ],
        vendorIds: [vendorId],
      });
    expect(created.status).toBe(201);
    rfqId = created.body.data.id as string;
  });

  afterAll(async () => {
    await prisma.rfqQuote.deleteMany({ where: { vendorId } });
    await prisma.rfqVendor.deleteMany({ where: { rfqId } });
    await prisma.rfqItem.deleteMany({ where: { rfqId } });
    await prisma.rfq.deleteMany({ where: { id: rfqId } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("exports a quote sheet and imports it back with rates and a regret", async () => {
    const sheet = await request(app)
      .get(`/api/v1/rfqs/${rfqId}/quote-sheet`)
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(sheet.status).toBe(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(sheet.body as unknown as ArrayBuffer);
    const ws = workbook.worksheets[0]!;
    ws.getCell("F2").value = 152.5; // Rate for the first item
    ws.getCell("I2").value = "N";
    ws.getCell("I3").value = "Y"; // Second item: regret
    const filled = Buffer.from(await workbook.xlsx.writeBuffer());

    const imported = await request(app)
      .post(`/api/v1/rfqs/${rfqId}/quotes/import`)
      .set("Authorization", `Bearer ${token}`)
      .field("vendorId", vendorId)
      .attach("file", filled, "quotes.xlsx");

    expect(imported.status).toBe(200);
    expect(imported.body.data.imported).toBe(2);
    expect(imported.body.data.errors).toEqual([]);

    const comparison = await request(app)
      .get(`/api/v1/rfqs/${rfqId}/comparison`)
      .set("Authorization", `Bearer ${token}`);
    const [first, second] = comparison.body.data.items;
    expect(first.quotes[0].rate).toBe(152.5);
    expect(second.quotes[0].regretted).toBe(true);
    expect(second.quotes[0].rate).toBeNull();
  });

  it("lists the imported price in item history and excludes the regret", async () => {
    const res = await request(app)
      .get("/api/v1/rfqs/item-prices")
      .query({ vendorId })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);

    const rows = res.body.data.items as Array<{
      description: string;
      rate: number;
      vendorId: string;
    }>;
    const priced = rows.filter((r) => r.vendorId === vendorId);
    expect(priced).toHaveLength(1);
    expect(priced[0]!.description).toBe("XLPE Cable 4C x16");
    expect(priced[0]!.rate).toBe(152.5);
    // The regretted second line has no price and must not appear.
    expect(rows.some((r) => r.description === "XLPE Cable 4C x25")).toBe(false);
  });
});
