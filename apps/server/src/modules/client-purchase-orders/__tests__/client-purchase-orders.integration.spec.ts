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
 * Requires a real Postgres + Redis + MinIO (`<S3_BUCKET>-test` bucket) reachable via .env.test,
 * migrated. Run via the root `pnpm test` after `docker compose up`.
 */
describe("Client purchase orders on a project (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let accessToken: string;
  let organizationId: string;
  let tenderId: string;
  let projectId: string;
  let vendorId: string;
  let orderId: string;
  const boqItemIds = { cable: randomUUID(), gland: randomUUID() };
  const poNumber = `CPO-${randomUUID().slice(0, 8)}`;

  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    accessToken = testUser.accessToken;
    const userId = testUser.userId;

    organizationId = (
      await prisma.organization.create({
        data: { id: randomUUID(), name: `CPO Client ${randomUUID()}`, type: "GOVERNMENT", createdById: userId },
      })
    ).id;

    const tenderResponse = await request(app)
      .post("/api/v1/tenders")
      .set(auth())
      .send({ tenderNumber: `TND-CPO-${randomUUID().slice(0, 8)}`, title: "Client PO Tender", clientId: organizationId });
    tenderId = tenderResponse.body.data.id;
    const tender = await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });

    const boqId = randomUUID();
    await prisma.boq.create({
      data: { id: boqId, groupId: boqId, businessId: tender.businessId, tenderId, createdById: userId },
    });
    await prisma.boqItem.createMany({
      data: [
        { id: boqItemIds.cable, boqId, description: "Test cable", unit: "Mtr", quantity: 100, rate: 250, amount: 25000, sortOrder: 0 },
        { id: boqItemIds.gland, boqId, description: "Test gland", unit: "Nos", quantity: 20, rate: 40, amount: 800, sortOrder: 1 },
      ],
    });

    await request(app).put(`/api/v1/tenders/${tenderId}/rates-lock`).set(auth()).send({ locked: true });
    await request(app).patch(`/api/v1/tenders/${tenderId}/status`).set(auth()).send({ status: "SUBMITTED", submissionReference: "REF-1" });
    const won = await request(app)
      .patch(`/api/v1/tenders/${tenderId}/status`)
      .set(auth())
      .send({ status: "WON", winnerName: "Us", winningBidAmount: 25800 });
    expect(won.status).toBe(200);

    const project = await request(app)
      .post("/api/v1/projects/from-tender")
      .set(auth())
      .send({ tenderId, startDate: new Date().toISOString() });
    expect(project.status).toBe(201);
    projectId = project.body.data.id;

    vendorId = (
      await prisma.vendor.create({ data: { name: `CPO Vendor ${randomUUID()}`, category: "MATERIAL_SUPPLIER", createdById: userId } })
    ).id;
    await prisma.purchaseOrder.create({
      data: {
        businessId: tender.businessId,
        poNumber: `VPO-${randomUUID().slice(0, 8)}`,
        vendorId,
        tenderId,
        status: "PARTIALLY_RECEIVED",
        createdById: userId,
        items: { create: [{ description: "Test cable", unit: "Mtr", quantity: 100, rate: 200, amount: 20000, receivedQuantity: 40 }] },
      },
    });
  });

  afterAll(async () => {
    await prisma.attachment.deleteMany({ where: { entityType: "ClientPurchaseOrder", entityId: orderId } });
    await prisma.project.deleteMany({ where: { tenderId } });
    await prisma.purchaseOrder.deleteMany({ where: { tenderId } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("records a client PO with its due date defaulted from the tender's delivery period", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/client-purchase-orders`)
      .set(auth())
      .send({
        poNumber,
        poDate: "2026-11-01",
        items: [{ boqItemId: boqItemIds.cable, description: "Test cable", unit: "Mtr", quantity: 100, rate: 240 }],
      });
    expect(response.status).toBe(201);
    expect(response.body.data.deliveryDueDate.slice(0, 10)).toBe("2027-03-01");
    expect(response.body.data.items[0].flags).toEqual(["RATE_MISMATCH"]);
    expect(response.body.data.items[0].quotedRate).toBe(250);
    orderId = response.body.data.id;
  });

  it("rejects the same client PO number twice", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/client-purchase-orders`)
      .set(auth())
      .send({ poNumber, poDate: "2026-11-01", items: [{ description: "Other", quantity: 1, rate: 1 }] });
    expect(response.status).toBe(409);
  });

  it("attaches the PO document", async () => {
    const response = await request(app)
      .post(`/api/v1/client-purchase-orders/${orderId}/document`)
      .set(auth())
      .attach("file", Buffer.from("%PDF-1.4\n%test\n"), { filename: "client-po.pdf", contentType: "application/pdf" });
    expect(response.status).toBe(200);
    expect(response.body.data.documents).toHaveLength(1);
  });

  it("lists the project's POs with unordered BOQ lines and the earliest due date", async () => {
    const response = await request(app).get(`/api/v1/projects/${projectId}/client-purchase-orders`).set(auth());
    expect(response.status).toBe(200);
    expect(response.body.data.totalValue).toBe(24000);
    expect(response.body.data.unorderedBoqItems.map((line: { boqItemId: string }) => line.boqItemId)).toEqual([boqItemIds.gland]);
    expect(response.body.data.earliestDueDate.slice(0, 10)).toBe("2027-03-01");
  });

  it("returns the overview with vendors and vendor POs received so far", async () => {
    const response = await request(app).get(`/api/v1/projects/${projectId}/overview`).set(auth());
    expect(response.status).toBe(200);
    expect(response.body.data.tender.id).toBe(tenderId);
    expect(response.body.data.vendors).toHaveLength(1);
    expect(response.body.data.procurement).toEqual({ orderedValue: 20000, receivedValue: 8000 });
  });

  it("updates the lines and deletes the PO", async () => {
    const updated = await request(app)
      .patch(`/api/v1/client-purchase-orders/${orderId}`)
      .set(auth())
      .send({ items: [{ boqItemId: boqItemIds.cable, description: "Test cable", unit: "Mtr", quantity: 100, rate: 250 }] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.items[0].flags).toEqual([]);

    const deleted = await request(app).delete(`/api/v1/client-purchase-orders/${orderId}`).set(auth());
    expect(deleted.status).toBe(200);
    const missing = await request(app).get(`/api/v1/client-purchase-orders/${orderId}`).set(auth());
    expect(missing.status).toBe(404);
  });
});
