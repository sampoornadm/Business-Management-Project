import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import {
  cleanupIntegrationTestUser,
  createIntegrationTestUser,
  switchToSecondBusiness,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";

/**
 * Requires a real Postgres + Redis reachable via .env.test, migrated
 * (`pnpm db:migrate` against the test database). Run via
 * `pnpm --filter @bmp/server test` after `docker compose up`.
 */
describe("Reports & search (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let accessToken: string;
  let organizationId: string;
  let tenderId: string;

  function tenderPayload() {
    return {
      tenderNumber: `TND-RPT-${randomUUID().slice(0, 8)}`,
      title: "Reports Integration Searchable Tender",
      department: "PWD",
      clientId: organizationId,
      type: "OPEN",
      category: "ROAD",
      location: "Test City",
      state: "Test State",
      estimatedCost: 500000,
      submissionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    accessToken = testUser.accessToken;

    const org = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: `Reports Integration Client ${randomUUID()}`,
        type: "GOVERNMENT",
        createdById: testUser.userId,
      },
    });
    organizationId = org.id;

    const tenderResponse = await request(app)
      .post("/api/v1/tenders")
      .set("Authorization", `Bearer ${accessToken}`)
      .send(tenderPayload());
    tenderId = tenderResponse.body.data.id as string;
  });

  afterAll(async () => {
    await prisma.tender.deleteMany({ where: { createdById: testUser.userId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("returns the tender pipeline report", async () => {
    const response = await request(app)
      .get("/api/v1/reports/tender-pipeline")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.totalTenders).toBeGreaterThanOrEqual(1);
  });

  it("returns the KPI dashboard", async () => {
    const response = await request(app).get("/api/v1/reports/kpis").set("Authorization", `Bearer ${accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveProperty("winRate");
  });

  it("exports the tender pipeline report as a valid xlsx file", async () => {
    const response = await request(app)
      .get("/api/v1/reports/tender-pipeline/export?format=xlsx")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml");
    expect(Number(response.headers["content-length"])).toBeGreaterThan(0);
  });

  it("finds the seeded tender via global search", async () => {
    const response = await request(app)
      .get("/api/v1/search?q=Searchable")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.results.some((r: { id: string }) => r.id === tenderId)).toBe(true);
  });

  it("rejects a search query shorter than 2 characters", async () => {
    const response = await request(app).get("/api/v1/search?q=a").set("Authorization", `Bearer ${accessToken}`);
    expect(response.status).toBe(400);
  });

  it("does not include another business's tenders in the pipeline report or KPIs", async () => {
    await request(app)
      .post("/api/v1/tenders")
      .set("Authorization", `Bearer ${accessToken}`)
      .send(tenderPayload());

    const secondBusinessToken = await switchToSecondBusiness(app, testUser);

    const pipelineResponse = await request(app)
      .get("/api/v1/reports/tender-pipeline")
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(pipelineResponse.status).toBe(200);
    expect(pipelineResponse.body.data.totalTenders).toBe(0);

    const kpisResponse = await request(app)
      .get("/api/v1/reports/kpis")
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(kpisResponse.status).toBe(200);
    expect(kpisResponse.body.data.winRate).toBeNull();
  });
});
