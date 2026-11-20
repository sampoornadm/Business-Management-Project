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
describe("Shipments: dispatch, GRN, bill, payment (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let accessToken: string;
  let organizationId: string;
  let tenderId: string;
  let projectId: string;
  let vendorId: string;
  let clientPoId: string;
  let clientPoItemId: string;
  let shipmentId: string;
  let billId: string;
  const boqItemId = randomUUID();

  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    accessToken = testUser.accessToken;
    const userId = testUser.userId;

    organizationId = (
      await prisma.organization.create({
        data: { id: randomUUID(), name: `Shipment Client ${randomUUID()}`, type: "GOVERNMENT", createdById: userId },
      })
    ).id;
    const tenderResponse = await request(app)
      .post("/api/v1/tenders")
      .set(auth())
      .send({ tenderNumber: `TND-SHP-${randomUUID().slice(0, 8)}`, title: "Shipment Tender", clientId: organizationId });
    tenderId = tenderResponse.body.data.id;
    const tender = await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });

    const boqId = randomUUID();
    await prisma.boq.create({ data: { id: boqId, groupId: boqId, businessId: tender.businessId, tenderId, createdById: userId } });
    await prisma.boqItem.create({
      data: { id: boqItemId, boqId, description: "Test cable", unit: "Mtr", quantity: 100, rate: 250, amount: 25000 },
    });

    await request(app).put(`/api/v1/tenders/${tenderId}/rates-lock`).set(auth()).send({ locked: true });
    await request(app).patch(`/api/v1/tenders/${tenderId}/status`).set(auth()).send({ status: "SUBMITTED", submissionReference: "REF-1" });
    await request(app).patch(`/api/v1/tenders/${tenderId}/status`).set(auth()).send({ status: "WON", winnerName: "Us", winningBidAmount: 25000 });
    const project = await request(app).post("/api/v1/projects/from-tender").set(auth()).send({ tenderId, startDate: new Date().toISOString() });
    projectId = project.body.data.id;

    vendorId = (await prisma.vendor.create({ data: { name: `Shipment Vendor ${randomUUID()}`, category: "MATERIAL_SUPPLIER", createdById: userId } })).id;
    const vendorPo = await request(app)
      .post("/api/v1/purchase-orders")
      .set(auth())
      .send({ vendorId, tenderId, items: [{ boqItemId, description: "Test cable", unit: "Mtr", quantity: 100, rate: 200 }] });
    expect(vendorPo.status).toBe(201);
    await prisma.purchaseOrderItem.updateMany({ where: { purchaseOrderId: vendorPo.body.data.id }, data: { receivedQuantity: 80 } });

    const clientPo = await request(app)
      .post(`/api/v1/projects/${projectId}/client-purchase-orders`)
      .set(auth())
      .send({ poNumber: `CPO-${randomUUID().slice(0, 8)}`, poDate: "2026-11-01", items: [{ boqItemId, description: "Test cable", unit: "Mtr", quantity: 100, rate: 250 }] });
    clientPoId = clientPo.body.data.id;
    clientPoItemId = clientPo.body.data.items[0].id;
  });

  afterAll(async () => {
    await prisma.attachment.deleteMany({ where: { entityType: "Shipment", entityId: shipmentId } });
    await prisma.payment.deleteMany({ where: { entityType: "Bill", entityId: billId } });
    await prisma.shipment.deleteMany({ where: { projectId } });
    await prisma.bill.deleteMany({ where: { tenderId } });
    await prisma.project.deleteMany({ where: { tenderId } });
    await prisma.purchaseOrder.deleteMany({ where: { tenderId } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("mounts the document reader and rejects an unknown kind before reading anything", async () => {
    const missing = await request(app).post(`/api/v1/projects/${projectId}/documents/read`).set(auth());
    expect(missing.status).toBe(400);
    const badKind = await request(app)
      .post(`/api/v1/projects/${projectId}/documents/read`)
      .set(auth())
      .field("kind", "QUOTATION")
      .attach("file", Buffer.from("%PDF-1.4"), { filename: "doc.pdf", contentType: "application/pdf" });
    expect(badKind.status).toBe(400);
  });

  it("refuses to ship more than the client ordered", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/shipments`)
      .set(auth())
      .send({ clientPurchaseOrderId: clientPoId, items: [{ clientPoItemId, quantity: 101 }] });
    expect(response.status).toBe(400);
  });

  it("starts a shipment and shows it in the supply view next to vendor receipts", async () => {
    const created = await request(app)
      .post(`/api/v1/projects/${projectId}/shipments`)
      .set(auth())
      .send({ clientPurchaseOrderId: clientPoId, items: [{ clientPoItemId, quantity: 60 }] });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ number: 1, stage: "PREPARING", value: 15000 });
    shipmentId = created.body.data.id;

    const supply = await request(app).get(`/api/v1/projects/${projectId}/supply`).set(auth());
    expect(supply.status).toBe(200);
    expect(supply.body.data.lines[0]).toMatchObject({ ordered: 100, procured: 100, received: 80, dispatched: 0 });
  });

  it("keeps a shipped client PO line from being removed", async () => {
    const response = await request(app)
      .patch(`/api/v1/client-purchase-orders/${clientPoId}`)
      .set(auth())
      .send({ items: [{ description: "Something else", quantity: 1, rate: 1 }] });
    expect(response.status).toBe(409);
  });

  it("walks the shipment through dispatch, GRN, bill and payment", async () => {
    const early = await request(app).post(`/api/v1/shipments/${shipmentId}/bill`).set(auth());
    expect(early.status).toBe(409);

    const dispatched = await request(app)
      .post(`/api/v1/shipments/${shipmentId}/dispatch`)
      .set(auth())
      .send({ ewayBillNumber: "EWB-TEST-1", ewayBillDate: "2026-11-20", freightCost: 1200 });
    expect(dispatched.body.data.stage).toBe("DISPATCHED");

    const doc = await request(app)
      .post(`/api/v1/shipments/${shipmentId}/documents`)
      .set(auth())
      .field("documentType", "EWAY_BILL")
      .attach("file", Buffer.from("%PDF-1.4\n%test\n"), { filename: "eway.pdf", contentType: "application/pdf" });
    expect(doc.status).toBe(200);
    expect(doc.body.data.documents[0].documentType).toBe("EWAY_BILL");

    const grn = await request(app).post(`/api/v1/shipments/${shipmentId}/grn`).set(auth()).send({ grnNumber: "GRN-1", grnDate: "2026-11-25" });
    expect(grn.body.data.stage).toBe("GRN_RECEIVED");

    const billed = await request(app).post(`/api/v1/shipments/${shipmentId}/bill`).set(auth());
    expect(billed.status).toBe(200);
    expect(billed.body.data.stage).toBe("BILLED");
    expect(billed.body.data.bill.total).toBe(15000);
    billId = billed.body.data.bill.id;
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill.grnNumber).toBe("GRN-1");

    const partial = await request(app)
      .post(`/api/v1/shipments/${shipmentId}/payments`)
      .set(auth())
      .send({ amount: 10000, method: "CASH", settled: false });
    expect(partial.body.data).toMatchObject({ stage: "BILLED", amountReceived: 10000 });

    const paid = await request(app)
      .post(`/api/v1/shipments/${shipmentId}/payments`)
      .set(auth())
      .send({ amount: 7700, method: "CASH", settled: true });
    expect(paid.body.data).toMatchObject({ stage: "PAID", amountReceived: 17700 });

    const supply = await request(app).get(`/api/v1/projects/${projectId}/supply`).set(auth());
    expect(supply.body.data.lines[0]).toMatchObject({ dispatched: 60, accepted: 60 });
  });

  it("adds the project's money in and out into the profit report", async () => {
    await prisma.purchaseOrder.updateMany({ where: { tenderId }, data: { status: "ISSUED" } });
    const expense = await prisma.expense.create({
      data: {
        businessId: testUser.businessId,
        category: "TRANSPORT",
        description: "Unloading",
        amount: 500,
        projectId,
        createdById: testUser.userId,
      },
    });
    try {
      const report = await request(app).get(`/api/v1/reports/project-costing?projectId=${projectId}`).set(auth());
      expect(report.status).toBe(200);
      expect(report.body.data.projects).toHaveLength(1);
      expect(report.body.data.projects[0]).toMatchObject({
        clientPoValue: 25000,
        billed: 15000,
        received: 17700,
        vendorCost: 20000,
        freight: 1200,
        otherCosts: 500,
        totalCost: 21700,
        profit: -4000,
        expectedProfit: 3300,
      });
    } finally {
      await prisma.expense.delete({ where: { id: expense.id } });
    }
  });

  it("steps back from paid but not past a raised bill", async () => {
    const back = await request(app).post(`/api/v1/shipments/${shipmentId}/undo`).set(auth());
    expect(back.body.data.stage).toBe("BILLED");
    const stuck = await request(app).post(`/api/v1/shipments/${shipmentId}/undo`).set(auth());
    expect(stuck.status).toBe(409);
    const notDeletable = await request(app).delete(`/api/v1/shipments/${shipmentId}`).set(auth());
    expect(notDeletable.status).toBe(409);
  });
});
