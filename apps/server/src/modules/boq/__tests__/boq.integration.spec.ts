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
describe("BOQ upload/commit workflow (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let accessToken: string;
  let userId: string;
  let organizationId: string;
  let tenderId: string;

  async function buildFixtureXlsx(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("BOQ");
    sheet.addRow(["Item Code", "Description", "Unit", "Quantity", "Rate"]);
    sheet.addRow(["1", "Excavation", "cum", 100, 50]);
    sheet.addRow(["2", "Backfilling", "cum", 40, 20]);
    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  async function createTender(overrides: { tenderNumber: string }): Promise<string> {
    const tenderResponse = await request(app)
      .post("/api/v1/tenders")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        tenderNumber: overrides.tenderNumber,
        title: "BOQ Integration Tender",
        department: "PWD",
        clientId: organizationId,
        type: "OPEN",
        category: "ROAD",
        location: "Test City",
        state: "Test State",
        estimatedCost: 500000,
        submissionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
    return tenderResponse.body.data.id as string;
  }

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    accessToken = testUser.accessToken;
    userId = testUser.userId;

    const org = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: `BOQ Integration Client ${randomUUID()}`,
        type: "GOVERNMENT",
        createdById: userId,
      },
    });
    organizationId = org.id;

    tenderId = await createTender({ tenderNumber: `TND-BOQ-${randomUUID().slice(0, 8)}` });
  });

  afterAll(async () => {
    await prisma.boq.deleteMany({ where: { tenderId } });
    await prisma.attachment.deleteMany({ where: { uploadedById: userId } });
    await prisma.tender.deleteMany({ where: { createdById: userId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("uploads and parses a BOQ Excel file into a mapping preview", async () => {
    const buffer = await buildFixtureXlsx();

    const response = await request(app)
      .post(`/api/v1/tenders/${tenderId}/boq/parse`)
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", buffer, "fixture.xlsx");

    expect(response.status).toBe(200);
    expect(response.body.data.rows).toHaveLength(2);
    expect(response.body.data.suggestedMapping.description).toBe("Description");
    expect(response.body.data.suggestedMapping.rate).toBe("Rate");
  });

  it("commits parsed rows, then fetches back a matching item tree", async () => {
    const commitResponse = await request(app)
      .post(`/api/v1/tenders/${tenderId}/boq`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        items: [
          { tempId: "1", description: "Excavation", unit: "cum", quantity: 100, rate: 50 },
          { tempId: "2", description: "Backfilling", unit: "cum", quantity: 40, rate: 20 },
        ],
      });

    expect(commitResponse.status).toBe(201);
    expect(commitResponse.body.data.totalAmount).toBe(5800);
    expect(commitResponse.body.data.version).toBe(1);

    const getResponse = await request(app)
      .get(`/api/v1/tenders/${tenderId}/boq`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data.items).toHaveLength(2);
    expect(getResponse.body.data.totalAmount).toBe(5800);
  });

  it("creates a second version via replacesBoqId and lists both versions", async () => {
    const current = await request(app)
      .get(`/api/v1/tenders/${tenderId}/boq`)
      .set("Authorization", `Bearer ${accessToken}`);
    const firstBoqId = current.body.data.id as string;

    const secondCommit = await request(app)
      .post(`/api/v1/tenders/${tenderId}/boq`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        replacesBoqId: firstBoqId,
        items: [{ tempId: "1", description: "Excavation", unit: "cum", quantity: 100, rate: 55 }],
      });
    expect(secondCommit.status).toBe(201);
    expect(secondCommit.body.data.version).toBe(2);

    const versions = await request(app)
      .get(`/api/v1/tenders/${tenderId}/boq/versions`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(versions.status).toBe(200);
    expect(versions.body.data).toHaveLength(2);
    expect(versions.body.data.find((v: { version: number }) => v.version === 2).isCurrent).toBe(true);
    expect(versions.body.data.find((v: { version: number }) => v.version === 1).isCurrent).toBe(false);
  });

  it("does not return another business's BOQ, and rejects direct access to its items", async () => {
    const otherLogin = await request(app).post("/api/v1/auth/login").send({
      email: testUser.email,
      password: "Password123",
    });
    // switch to the second business this same test user also belongs to
    const switchResponse = await request(app)
      .post("/api/v1/auth/switch-business")
      .set("Authorization", `Bearer ${otherLogin.body.data.accessToken}`)
      .send({ businessId: testUser.secondBusinessId });
    const secondBusinessToken = switchResponse.body.data.accessToken as string;

    // Create a tender and commit a BOQ, entirely in the first business.
    const isolationTenderId = await createTender({
      tenderNumber: `TND-BOQ-ISO-${randomUUID().slice(0, 8)}`,
    });
    const commitResponse = await request(app)
      .post(`/api/v1/tenders/${isolationTenderId}/boq`)
      .set("Authorization", `Bearer ${accessToken}`) // first business
      .send({
        items: [{ tempId: "1", description: "Excavation", unit: "cum", quantity: 100, rate: 50 }],
      });
    expect(commitResponse.status).toBe(201);
    const isolationBoqId = commitResponse.body.data.id as string;
    const isolationItemId = commitResponse.body.data.items[0].id as string;

    // Fetch paths nested under the (already business-scoped) tenderId.
    const getResponse = await request(app)
      .get(`/api/v1/tenders/${isolationTenderId}/boq`)
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(getResponse.status).toBe(404);

    const versionsResponse = await request(app)
      .get(`/api/v1/tenders/${isolationTenderId}/boq/versions`)
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(versionsResponse.status).toBe(404);

    // Item-level mutation routes are mounted at /boq-items/:itemId with no
    // tenderId (or any other parent id) in the path at all, so they can't
    // rely on an already-scoped tenderId lookup the way the routes above do.
    // These must independently scope through the parent Boq's businessId —
    // assert a second-business token can't read/mutate/delete an item that
    // belongs to a BOQ committed under the first business.
    const patchResponse = await request(app)
      .patch(`/api/v1/boq-items/${isolationItemId}`)
      .set("Authorization", `Bearer ${secondBusinessToken}`)
      .send({ description: "Hijacked" });
    expect(patchResponse.status).toBe(404);

    const rateAnalysisResponse = await request(app)
      .put(`/api/v1/boq-items/${isolationItemId}/rate-analysis`)
      .set("Authorization", `Bearer ${secondBusinessToken}`)
      .send({
        materialCost: 10,
        laborCost: 10,
        machineryCost: 0,
        transportCost: 0,
        overheadPercent: 0,
        profitPercent: 0,
        taxPercent: 0,
      });
    expect(rateAnalysisResponse.status).toBe(404);

    const bulkUpdateResponse = await request(app)
      .post("/api/v1/boq-items/bulk-update")
      .set("Authorization", `Bearer ${secondBusinessToken}`)
      .send({ itemIds: [isolationItemId], ratePercentAdjustment: 10 });
    expect(bulkUpdateResponse.status).toBe(400); // "not found" -> repository filters it out first

    const deleteResponse = await request(app)
      .delete(`/api/v1/boq-items/${isolationItemId}`)
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(deleteResponse.status).toBe(404);

    // Confirm nothing was mutated from the first business's perspective.
    const stillThereResponse = await request(app)
      .get(`/api/v1/tenders/${isolationTenderId}/boq`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(stillThereResponse.status).toBe(200);
    expect(stillThereResponse.body.data.items).toHaveLength(1);
    expect(stillThereResponse.body.data.items[0].description).toBe("Excavation");

    await prisma.boq.deleteMany({ where: { id: isolationBoqId } });
    await prisma.tender.deleteMany({ where: { id: isolationTenderId } });
  });
});
