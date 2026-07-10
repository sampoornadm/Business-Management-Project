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
describe("Project execution workflow (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let accessToken: string;
  let userId: string;
  let organizationId: string;
  let tenderId: string;
  let projectId: string;

  const WON_TRANSITION_CHAIN = ["SUBMITTED"];

  async function createWonTender(overrides: { tenderNumber: string }): Promise<string> {
    const tenderResponse = await request(app)
      .post("/api/v1/tenders")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        tenderNumber: overrides.tenderNumber,
        title: "Project Integration Tender",
        department: "PWD",
        clientId: organizationId,
        type: "OPEN",
        category: "ROAD",
        location: "Test City",
        state: "Test State",
        estimatedCost: 500000,
        submissionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
    const newTenderId = tenderResponse.body.data.id as string;

    for (const status of WON_TRANSITION_CHAIN) {
      const response = await request(app)
        .patch(`/api/v1/tenders/${newTenderId}/status`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ status });
      expect(response.status).toBe(200);
    }
    const wonResponse = await request(app)
      .patch(`/api/v1/tenders/${newTenderId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "WON", winnerName: "Us", winningBidAmount: 480000 });
    expect(wonResponse.status).toBe(200);

    return newTenderId;
  }

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    accessToken = testUser.accessToken;
    userId = testUser.userId;

    const org = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: `Project Integration Client ${randomUUID()}`,
        type: "GOVERNMENT",
        createdById: userId,
      },
    });
    organizationId = org.id;

    tenderId = await createWonTender({ tenderNumber: `TND-PROJ-${randomUUID().slice(0, 8)}` });
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.projectBill.deleteMany({ where: { projectId } });
      await prisma.projectLaborEntry.deleteMany({ where: { projectId } });
      await prisma.projectMaterialUsage.deleteMany({ where: { projectId } });
      await prisma.projectMilestone.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    await prisma.tender.deleteMany({ where: { createdById: userId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("converts the WON tender into a project", async () => {
    const response = await request(app)
      .post("/api/v1/projects/from-tender")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ tenderId, startDate: new Date().toISOString() });

    expect(response.status).toBe(201);
    expect(response.body.data.budget).toBe(480000);
    projectId = response.body.data.id;
  });

  it("rejects converting the same tender twice", async () => {
    const response = await request(app)
      .post("/api/v1/projects/from-tender")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ tenderId, startDate: new Date().toISOString() });
    expect(response.status).toBe(409);
  });

  it("adds a milestone and marks it complete, reflected in progress", async () => {
    const addResponse = await request(app)
      .post(`/api/v1/projects/${projectId}/milestones`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ title: "Foundation", weightPercent: 50 });
    expect(addResponse.status).toBe(201);
    const milestoneId = addResponse.body.data.milestones[0].id;

    const completeResponse = await request(app)
      .patch(`/api/v1/projects/${projectId}/milestones/${milestoneId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "COMPLETED" });
    expect(completeResponse.status).toBe(200);

    const progressResponse = await request(app)
      .get(`/api/v1/projects/${projectId}/progress`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(progressResponse.status).toBe(200);
    expect(progressResponse.body.data.milestoneProgressPercent).toBe(50);
  });

  it("records a labor entry with a server-computed amount", async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/labor-entries`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ category: "SKILLED", description: "Masons", workerCount: 4, units: 8, ratePerUnit: 50 });
    expect(response.status).toBe(201);
    expect(response.body.data[0].amount).toBe(1600);
  });

  it("creates two bills and computes the second bill's amount as the delta", async () => {
    const first = await request(app)
      .post(`/api/v1/projects/${projectId}/bills`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ billNumber: "RA-1", cumulativeAmount: 100000 });
    expect(first.status).toBe(201);
    expect(first.body.data[0].currentBillAmount).toBe(100000);

    const second = await request(app)
      .post(`/api/v1/projects/${projectId}/bills`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ billNumber: "RA-2", cumulativeAmount: 175000 });
    expect(second.status).toBe(201);
    expect(second.body.data[1].currentBillAmount).toBe(75000);
  });

  it("reflects labor costs in the costing summary", async () => {
    const response = await request(app)
      .get(`/api/v1/projects/${projectId}/costing`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.laborTotal).toBe(1600);
    expect(response.body.data.budget).toBe(480000);
  });

  it("does not return another business's projects, and rejects direct access to them", async () => {
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

    // Create + win a tender, then convert it to a project — all in the first business.
    const isolationTenderId = await createWonTender({
      tenderNumber: `TND-PROJ-ISO-${randomUUID().slice(0, 8)}`,
    });
    const projectResponse = await request(app)
      .post("/api/v1/projects/from-tender")
      .set("Authorization", `Bearer ${accessToken}`) // first business
      .send({ tenderId: isolationTenderId, startDate: new Date().toISOString() });
    expect(projectResponse.status).toBe(201);
    const isolationProjectId = projectResponse.body.data.id as string;

    const listResponse = await request(app)
      .get("/api/v1/projects")
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.items.map((p: { id: string }) => p.id)).not.toContain(isolationProjectId);

    const getByIdResponse = await request(app)
      .get(`/api/v1/projects/${isolationProjectId}`)
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(getByIdResponse.status).toBe(404);

    await prisma.project.deleteMany({ where: { id: isolationProjectId } });
    await prisma.tender.deleteMany({ where: { id: isolationTenderId } });
  });
});
