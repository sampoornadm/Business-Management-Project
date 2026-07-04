import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { WILDCARD_PERMISSION } from "@bmp/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import { hashPassword } from "../../../shared/utils/hash.js";

/**
 * Requires a real Postgres + Redis reachable via .env.test, migrated
 * (`pnpm db:migrate` against the test database). Run via
 * `pnpm --filter @bmp/server test` after `docker compose up`.
 */
describe("Procurement workflow (integration)", () => {
  const app = createApp();
  const email = `procurement-integration-${randomUUID()}@example.com`;
  const password = "Password123";
  let accessToken: string;
  let vendorId: string;
  let rfqId: string;
  let poId: string;

  beforeAll(async () => {
    const permission = await prisma.permission.upsert({
      where: { key: WILDCARD_PERMISSION },
      update: {},
      create: { id: randomUUID(), key: WILDCARD_PERMISSION, resource: "*", action: "*" },
    });

    const role = await prisma.role.upsert({
      where: { name: "SUPER_ADMIN" },
      update: {},
      create: { id: randomUUID(), name: "SUPER_ADMIN", description: "Super Admin", isSystem: true },
    });

    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { id: randomUUID(), roleId: role.id, permissionId: permission.id },
    });

    await prisma.user.create({
      data: {
        id: randomUUID(),
        email,
        passwordHash: await hashPassword(password),
        firstName: "Procurement",
        lastName: "Tester",
        roleId: role.id,
        isActive: true,
        isEmailVerified: true,
      },
    });

    const loginResponse = await request(app).post("/api/v1/auth/login").send({ email, password });
    accessToken = loginResponse.body.data.accessToken;
  });

  afterAll(async () => {
    if (poId) {
      await prisma.vendorRating.deleteMany({ where: { purchaseOrderId: poId } });
      await prisma.goodsReceipt.deleteMany({ where: { purchaseOrderId: poId } });
      await prisma.purchaseOrder.deleteMany({ where: { id: poId } });
    }
    if (rfqId) await prisma.rfq.deleteMany({ where: { id: rfqId } });
    if (vendorId) await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("creates a vendor", async () => {
    const response = await request(app)
      .post("/api/v1/vendors")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: `Integration Vendor ${randomUUID().slice(0, 8)}`, category: "MATERIAL_SUPPLIER" });
    expect(response.status).toBe(201);
    vendorId = response.body.data.id;
  });

  it("creates an RFQ with manual items and invites the vendor", async () => {
    const response = await request(app)
      .post("/api/v1/rfqs")
      .set("Authorization", `Bearer ${accessToken}`)
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
      .set("Authorization", `Bearer ${accessToken}`);
    const itemId = rfqResponse.body.data.items[0].id;

    const quoteResponse = await request(app)
      .put(`/api/v1/rfq-items/${itemId}/quotes/${vendorId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ rate: 375 });
    expect(quoteResponse.status).toBe(200);

    const comparisonResponse = await request(app)
      .get(`/api/v1/rfqs/${rfqId}/comparison`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(comparisonResponse.status).toBe(200);
    expect(comparisonResponse.body.data.items[0].quotes[0].isLowest).toBe(true);
  });

  it("awards the RFQ and creates a purchase order from it", async () => {
    const awardResponse = await request(app)
      .post(`/api/v1/rfqs/${rfqId}/award`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ vendorId });
    expect(awardResponse.status).toBe(200);
    expect(awardResponse.body.data.status).toBe("AWARDED");

    const poResponse = await request(app)
      .post("/api/v1/purchase-orders/from-rfq")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ rfqId });
    expect(poResponse.status).toBe(201);
    expect(poResponse.body.data.items[0].rate).toBe(375);
    poId = poResponse.body.data.id;
  });

  it("issues the PO and receives goods across two partial deliveries", async () => {
    const issueResponse = await request(app)
      .patch(`/api/v1/purchase-orders/${poId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "ISSUED" });
    expect(issueResponse.status).toBe(200);

    const poDetail = await request(app)
      .get(`/api/v1/purchase-orders/${poId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    const itemId = poDetail.body.data.items[0].id;

    const firstReceipt = await request(app)
      .post(`/api/v1/purchase-orders/${poId}/goods-receipts`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ items: [{ purchaseOrderItemId: itemId, quantityReceived: 40 }] });
    expect(firstReceipt.status).toBe(201);
    expect(firstReceipt.body.data.status).toBe("PARTIALLY_RECEIVED");

    const secondReceipt = await request(app)
      .post(`/api/v1/purchase-orders/${poId}/goods-receipts`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ items: [{ purchaseOrderItemId: itemId, quantityReceived: 60 }] });
    expect(secondReceipt.status).toBe(201);
    expect(secondReceipt.body.data.status).toBe("RECEIVED");
  });

  it("rates the vendor once the PO is fully received", async () => {
    const response = await request(app)
      .put(`/api/v1/purchase-orders/${poId}/vendor-rating`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ rating: 5, remarks: "Delivered on time" });
    expect(response.status).toBe(200);
    expect(response.body.data.vendorRating.rating).toBe(5);

    const performanceResponse = await request(app)
      .get(`/api/v1/vendors/${vendorId}/performance`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(performanceResponse.status).toBe(200);
    expect(performanceResponse.body.data.averageRating).toBe(5);
  });
});
