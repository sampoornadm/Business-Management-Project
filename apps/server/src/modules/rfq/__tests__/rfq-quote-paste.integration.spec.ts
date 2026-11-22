import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import {
  cleanupIntegrationTestUser,
  createIntegrationTestUser,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";

/**
 * Requires a real Postgres + Redis reachable via .env.test. The pasted text here is fully
 * rule-readable, so Ollama is never called.
 */
describe("RFQ text quote paste (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let token: string;
  let vendorId: string;
  let rfqId: string;
  let itemIds: string[];

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    token = testUser.accessToken;

    const vendor = await prisma.vendor.create({
      data: {
        id: randomUUID(),
        name: `Paste Vendor ${randomUUID().slice(0, 8)}`,
        category: "MATERIAL_SUPPLIER",
        createdById: testUser.userId,
      },
    });
    vendorId = vendor.id;

    const created = await request(app)
      .post("/api/v1/rfqs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Quote Paste Integration RFQ",
        items: [
          { description: "O RING (12X1) MM", unit: "EA", quantity: 150 },
          { description: "O RING (12X1.5) MM", unit: "EA", quantity: 150 },
          { description: "O RING (16X1) MM", unit: "EA", quantity: 150 },
        ],
        vendorIds: [vendorId],
      });
    expect(created.status).toBe(201);
    rfqId = created.body.data.id as string;
    itemIds = (created.body.data.items as { id: string }[]).map((i) => i.id);

    await prisma.rfqQuote.create({ data: { rfqItemId: itemIds[2]!, vendorId, rate: 99 } });
  });

  afterAll(async () => {
    await prisma.rfqQuote.deleteMany({ where: { vendorId } });
    await prisma.rfqVendor.deleteMany({ where: { rfqId } });
    await prisma.rfqItem.deleteMany({ where: { rfqId } });
    await prisma.rfq.deleteMany({ where: { id: rfqId } });
    await prisma.auditLog.deleteMany({ where: { entityId: rfqId } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("previews a paste without writing anything", async () => {
    const res = await request(app)
      .post(`/api/v1/rfqs/${rfqId}/quotes/parse-text`)
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId, text: "1 - 100\n2 regret" });

    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({ rfqItemId: itemIds[0], rate: 100, source: "serial" });
    expect(items[1]).toMatchObject({ regretted: true, rate: null });
    expect(items[2]).toMatchObject({ currentRate: 99, rate: null, source: null });
    expect(await prisma.rfqQuote.count({ where: { vendorId } })).toBe(1);
  });

  it("rejects an empty paste", async () => {
    const res = await request(app)
      .post(`/api/v1/rfqs/${rfqId}/quotes/parse-text`)
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId, text: "" });
    expect(res.status).toBe(422);
  });

  it("saves the reviewed rows and leaves unmentioned items alone", async () => {
    const res = await request(app)
      .post(`/api/v1/rfqs/${rfqId}/quotes/bulk`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        vendorId,
        aiCount: 0,
        quotes: [
          { rfqItemId: itemIds[0], rate: 100 },
          { rfqItemId: itemIds[1], regretted: true },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ imported: 2 });

    const quotes = await prisma.rfqQuote.findMany({ where: { vendorId } });
    const byItem = new Map(quotes.map((q) => [q.rfqItemId, q]));
    expect(byItem.get(itemIds[0]!)).toMatchObject({ rate: 100, regretted: false });
    expect(byItem.get(itemIds[1]!)).toMatchObject({ rate: null, regretted: true });
    expect(byItem.get(itemIds[2]!)?.rate).toBe(99);

    const invite = await prisma.rfqVendor.findUnique({ where: { rfqId_vendorId: { rfqId, vendorId } } });
    expect(invite?.status).toBe("RESPONDED");
    expect(await prisma.auditLog.count({ where: { entityId: rfqId, action: "RFQ_QUOTES_PASTED" } })).toBe(1);
  });

  it("rejects a row that is neither priced nor regretted", async () => {
    const res = await request(app)
      .post(`/api/v1/rfqs/${rfqId}/quotes/bulk`)
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId, aiCount: 0, quotes: [{ rfqItemId: itemIds[0] }] });
    expect(res.status).toBe(422);
  });

  it("refuses both routes once the RFQ is finalized", async () => {
    const finalized = await request(app)
      .post(`/api/v1/rfqs/${rfqId}/finalize-rates`)
      .set("Authorization", `Bearer ${token}`);
    expect(finalized.status).toBe(200);

    const preview = await request(app)
      .post(`/api/v1/rfqs/${rfqId}/quotes/parse-text`)
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId, text: "1 - 100" });
    expect(preview.status).toBe(409);

    const save = await request(app)
      .post(`/api/v1/rfqs/${rfqId}/quotes/bulk`)
      .set("Authorization", `Bearer ${token}`)
      .send({ vendorId, aiCount: 0, quotes: [{ rfqItemId: itemIds[0], rate: 1 }] });
    expect(save.status).toBe(409);
  });
});
