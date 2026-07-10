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
 * Requires a real Postgres + Redis reachable via .env.test, migrated
 * (`pnpm db:migrate` against the test database). Run via
 * `pnpm --filter @bmp/server test` after `docker compose up`.
 */
describe("Procurement workflow (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let vendorId: string;
  let rfqId: string;
  let poId: string;

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
  });

  afterAll(async () => {
    if (poId) {
      await prisma.vendorRating.deleteMany({ where: { purchaseOrderId: poId } });
      await prisma.goodsReceipt.deleteMany({ where: { purchaseOrderId: poId } });
      await prisma.purchaseOrder.deleteMany({ where: { id: poId } });
    }
    if (rfqId) await prisma.rfq.deleteMany({ where: { id: rfqId } });
    if (vendorId) await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("creates a vendor", async () => {
    const response = await request(app)
      .post("/api/v1/vendors")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ name: `Integration Vendor ${randomUUID().slice(0, 8)}`, category: "MATERIAL_SUPPLIER" });
    expect(response.status).toBe(201);
    vendorId = response.body.data.id;
  });

  it("creates an RFQ with manual items and invites the vendor", async () => {
    const response = await request(app)
      .post("/api/v1/rfqs")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({
        title: "Cement Supply RFQ",
        items: [{ description: "OPC Cement", unit: "bag", quantity: 100 }],
        vendorIds: [vendorId],
      });
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe("SENT");
    rfqId = response.body.data.id;
  });

  it("records a vendor quote and shows it in the comparison", async () => {
    const rfqResponse = await request(app)
      .get(`/api/v1/rfqs/${rfqId}`)
      .set("Authorization", `Bearer ${testUser.accessToken}`);
    const itemId = rfqResponse.body.data.items[0].id;

    const quoteResponse = await request(app)
      .put(`/api/v1/rfq-items/${itemId}/quotes/${vendorId}`)
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ rate: 375 });
    expect(quoteResponse.status).toBe(200);

    const comparisonResponse = await request(app)
      .get(`/api/v1/rfqs/${rfqId}/comparison`)
      .set("Authorization", `Bearer ${testUser.accessToken}`);
    expect(comparisonResponse.status).toBe(200);
    expect(comparisonResponse.body.data.items[0].quotes[0].isLowest).toBe(true);
  });

  it("awards the RFQ and creates a purchase order from it", async () => {
    const awardResponse = await request(app)
      .post(`/api/v1/rfqs/${rfqId}/award`)
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ vendorId });
    expect(awardResponse.status).toBe(200);
    expect(awardResponse.body.data.status).toBe("AWARDED");

    const poResponse = await request(app)
      .post("/api/v1/purchase-orders/from-rfq")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ rfqId });
    expect(poResponse.status).toBe(201);
    expect(poResponse.body.data.items[0].rate).toBe(375);
    poId = poResponse.body.data.id;
  });

  it("issues the PO and receives goods across two partial deliveries", async () => {
    const issueResponse = await request(app)
      .patch(`/api/v1/purchase-orders/${poId}/status`)
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ status: "ISSUED" });
    expect(issueResponse.status).toBe(200);

    const poDetail = await request(app)
      .get(`/api/v1/purchase-orders/${poId}`)
      .set("Authorization", `Bearer ${testUser.accessToken}`);
    const itemId = poDetail.body.data.items[0].id;

    const firstReceipt = await request(app)
      .post(`/api/v1/purchase-orders/${poId}/goods-receipts`)
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ items: [{ purchaseOrderItemId: itemId, quantityReceived: 40 }] });
    expect(firstReceipt.status).toBe(201);
    expect(firstReceipt.body.data.status).toBe("PARTIALLY_RECEIVED");

    const secondReceipt = await request(app)
      .post(`/api/v1/purchase-orders/${poId}/goods-receipts`)
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ items: [{ purchaseOrderItemId: itemId, quantityReceived: 60 }] });
    expect(secondReceipt.status).toBe(201);
    expect(secondReceipt.body.data.status).toBe("RECEIVED");
  });

  it("rates the vendor once the PO is fully received", async () => {
    const response = await request(app)
      .put(`/api/v1/purchase-orders/${poId}/vendor-rating`)
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ rating: 5, remarks: "Delivered on time" });
    expect(response.status).toBe(200);
    expect(response.body.data.vendorRating.rating).toBe(5);

    const performanceResponse = await request(app)
      .get(`/api/v1/vendors/${vendorId}/performance`)
      .set("Authorization", `Bearer ${testUser.accessToken}`);
    expect(performanceResponse.status).toBe(200);
    expect(performanceResponse.body.data.averageRating).toBe(5);
  });
});

describe("RFQ business isolation (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
  });

  afterAll(async () => {
    await prisma.rfq.deleteMany({
      where: { businessId: { in: [testUser.businessId, testUser.secondBusinessId] } },
    });
    // The mutating-route isolation test below creates a Vendor (Vendor has
    // no businessId column of its own — it isn't retrofitted by this task),
    // which has a Restrict FK back to User via createdById.
    await prisma.vendor.deleteMany({ where: { createdById: testUser.userId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  // Switching requires a fresh login token (the original access token's
  // embedded businessId claim doesn't change), then trades it for a token
  // scoped to the second business this same test user also belongs to.
  async function switchToSecondBusiness(): Promise<string> {
    const otherLogin = await request(app).post("/api/v1/auth/login").send({
      email: testUser.email,
      password: "Password123",
    });
    const switchResponse = await request(app)
      .post("/api/v1/auth/switch-business")
      .set("Authorization", `Bearer ${otherLogin.body.data.accessToken}`)
      .send({ businessId: testUser.secondBusinessId });
    return switchResponse.body.data.accessToken as string;
  }

  it("does not return a standalone RFQ (no tenderId) from another business, and rejects direct access", async () => {
    // RFQs can be standalone — created with no tenderId at all — entirely in
    // the first business.
    const createResponse = await request(app)
      .post("/api/v1/rfqs")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({
        title: "Isolated Standalone RFQ",
        items: [{ description: "TMT Steel Rebar", unit: "kg", quantity: 500 }],
      });
    expect(createResponse.status).toBe(201);
    const isolationRfqId = createResponse.body.data.id as string;

    const secondBusinessToken = await switchToSecondBusiness();

    const listResponse = await request(app)
      .get("/api/v1/rfqs")
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.items.map((r: { id: string }) => r.id)).not.toContain(isolationRfqId);

    const getByIdResponse = await request(app)
      .get(`/api/v1/rfqs/${isolationRfqId}`)
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(getByIdResponse.status).toBe(404);
  });

  it("rejects a mutating request (remove vendor invite) against another business's RFQ", async () => {
    // Create a vendor and an RFQ that already has that vendor invited,
    // entirely in the first business. removeVendorInvite() previously
    // mutated the vendor invite before any RFQ ownership check existed at
    // all — this exercises that exact route to guard against it regressing.
    const vendorResponse = await request(app)
      .post("/api/v1/vendors")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ name: `Isolation Vendor ${randomUUID().slice(0, 8)}`, category: "MATERIAL_SUPPLIER" });
    expect(vendorResponse.status).toBe(201);
    const vendorId = vendorResponse.body.data.id as string;

    const createResponse = await request(app)
      .post("/api/v1/rfqs")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({
        title: "Isolated RFQ With Vendor Invite",
        items: [{ description: "TMT Steel Rebar", unit: "kg", quantity: 500 }],
        vendorIds: [vendorId],
      });
    expect(createResponse.status).toBe(201);
    const isolationRfqId = createResponse.body.data.id as string;
    expect(createResponse.body.data.vendorInvites).toHaveLength(1);

    const secondBusinessToken = await switchToSecondBusiness();

    const removeResponse = await request(app)
      .delete(`/api/v1/rfqs/${isolationRfqId}/vendors/${vendorId}`)
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(removeResponse.status).toBe(404);

    // Confirm the invite was not actually removed from the first business's
    // perspective — the request above must have been rejected before any
    // mutation, not merely hidden from the response.
    const stillThereResponse = await request(app)
      .get(`/api/v1/rfqs/${isolationRfqId}`)
      .set("Authorization", `Bearer ${testUser.accessToken}`);
    expect(stillThereResponse.status).toBe(200);
    expect(stillThereResponse.body.data.vendorInvites).toHaveLength(1);
  });
});

describe("Purchase order business isolation (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
  });

  afterAll(async () => {
    await prisma.vendorRating.deleteMany({
      where: { purchaseOrder: { businessId: { in: [testUser.businessId, testUser.secondBusinessId] } } },
    });
    await prisma.goodsReceipt.deleteMany({
      where: { businessId: { in: [testUser.businessId, testUser.secondBusinessId] } },
    });
    await prisma.purchaseOrder.deleteMany({
      where: { businessId: { in: [testUser.businessId, testUser.secondBusinessId] } },
    });
    // Vendor has no businessId column of its own — it isn't retrofitted by
    // this task — so it is cleaned up by creator instead.
    await prisma.vendor.deleteMany({ where: { createdById: testUser.userId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  // Switching requires a fresh login token (the original access token's
  // embedded businessId claim doesn't change), then trades it for a token
  // scoped to the second business this same test user also belongs to.
  async function switchToSecondBusiness(): Promise<string> {
    const otherLogin = await request(app).post("/api/v1/auth/login").send({
      email: testUser.email,
      password: "Password123",
    });
    const switchResponse = await request(app)
      .post("/api/v1/auth/switch-business")
      .set("Authorization", `Bearer ${otherLogin.body.data.accessToken}`)
      .send({ businessId: testUser.secondBusinessId });
    return switchResponse.body.data.accessToken as string;
  }

  async function createVendor(): Promise<string> {
    const response = await request(app)
      .post("/api/v1/vendors")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ name: `PO Isolation Vendor ${randomUUID().slice(0, 8)}`, category: "MATERIAL_SUPPLIER" });
    expect(response.status).toBe(201);
    return response.body.data.id as string;
  }

  it("does not return a standalone purchase order (no tenderId) from another business, and rejects direct access", async () => {
    // Purchase orders can be standalone — created with no tenderId at all —
    // entirely in the first business.
    const vendorId = await createVendor();
    const createResponse = await request(app)
      .post("/api/v1/purchase-orders")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({
        vendorId,
        items: [{ description: "TMT Steel Rebar", unit: "kg", quantity: 500, rate: 60 }],
      });
    expect(createResponse.status).toBe(201);
    const isolationPoId = createResponse.body.data.id as string;

    const secondBusinessToken = await switchToSecondBusiness();

    const listResponse = await request(app)
      .get("/api/v1/purchase-orders")
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.items.map((po: { id: string }) => po.id)).not.toContain(isolationPoId);

    const getByIdResponse = await request(app)
      .get(`/api/v1/purchase-orders/${isolationPoId}`)
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(getByIdResponse.status).toBe(404);
  });

  it("rejects a mutating request (issue status) against another business's purchase order", async () => {
    // Create a purchase order entirely in the first business. updateStatus()
    // previously looked the PO up by id with no businessId scope at all —
    // this exercises that exact route to guard against it regressing, and
    // confirms the status was not actually changed before being rejected
    // (not merely hidden from the response), mirroring the RFQ
    // removeVendorInvite ordering-bug regression test above.
    const vendorId = await createVendor();
    const createResponse = await request(app)
      .post("/api/v1/purchase-orders")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({
        vendorId,
        items: [{ description: "OPC Cement", unit: "bag", quantity: 100, rate: 380 }],
      });
    expect(createResponse.status).toBe(201);
    const isolationPoId = createResponse.body.data.id as string;

    const secondBusinessToken = await switchToSecondBusiness();

    const issueResponse = await request(app)
      .patch(`/api/v1/purchase-orders/${isolationPoId}/status`)
      .set("Authorization", `Bearer ${secondBusinessToken}`)
      .send({ status: "ISSUED" });
    expect(issueResponse.status).toBe(404);

    const stillDraftResponse = await request(app)
      .get(`/api/v1/purchase-orders/${isolationPoId}`)
      .set("Authorization", `Bearer ${testUser.accessToken}`);
    expect(stillDraftResponse.status).toBe(200);
    expect(stillDraftResponse.body.data.status).toBe("DRAFT");
  });

  it("rejects a mutating request (goods receipt) against another business's purchase order", async () => {
    // Issue the PO in the first business, then attempt to record a goods
    // receipt against it from the second business — createGoodsReceipt()
    // previously had no businessId parameter at all.
    const vendorId = await createVendor();
    const createResponse = await request(app)
      .post("/api/v1/purchase-orders")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({
        vendorId,
        items: [{ description: "OPC Cement", unit: "bag", quantity: 100, rate: 380 }],
      });
    expect(createResponse.status).toBe(201);
    const isolationPoId = createResponse.body.data.id as string;
    const itemId = createResponse.body.data.items[0].id as string;

    const issueResponse = await request(app)
      .patch(`/api/v1/purchase-orders/${isolationPoId}/status`)
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ status: "ISSUED" });
    expect(issueResponse.status).toBe(200);

    const secondBusinessToken = await switchToSecondBusiness();

    const receiptResponse = await request(app)
      .post(`/api/v1/purchase-orders/${isolationPoId}/goods-receipts`)
      .set("Authorization", `Bearer ${secondBusinessToken}`)
      .send({ items: [{ purchaseOrderItemId: itemId, quantityReceived: 10 }] });
    expect(receiptResponse.status).toBe(404);

    const stillIssuedResponse = await request(app)
      .get(`/api/v1/purchase-orders/${isolationPoId}`)
      .set("Authorization", `Bearer ${testUser.accessToken}`);
    expect(stillIssuedResponse.status).toBe(200);
    expect(stillIssuedResponse.body.data.status).toBe("ISSUED");
    expect(stillIssuedResponse.body.data.goodsReceipts).toHaveLength(0);
  });
});
