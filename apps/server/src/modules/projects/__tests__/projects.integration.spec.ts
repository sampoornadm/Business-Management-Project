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
describe("Project execution workflow (integration)", () => {
  const app = createApp();
  const email = `project-integration-${randomUUID()}@example.com`;
  const password = "Password123";
  let accessToken: string;
  let userId: string;
  let organizationId: string;
  let tenderId: string;
  let projectId: string;

  const WON_TRANSITION_CHAIN = [
    "UPCOMING",
    "DOCUMENT_COLLECTION",
    "UNDER_STUDY",
    "BOQ_PREPARATION",
    "RATE_ANALYSIS",
    "APPROVAL_PENDING",
    "SUBMITTED",
    "TECHNICALLY_QUALIFIED",
    "FINANCIALLY_QUALIFIED",
  ];

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

    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email,
        passwordHash: await hashPassword(password),
        firstName: "Project",
        lastName: "Tester",
        roleId: role.id,
        isActive: true,
        isEmailVerified: true,
      },
    });
    userId = user.id;

    const loginResponse = await request(app).post("/api/v1/auth/login").send({ email, password });
    accessToken = loginResponse.body.data.accessToken;

    const org = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: `Project Integration Client ${randomUUID()}`,
        type: "GOVERNMENT",
        createdById: user.id,
      },
    });
    organizationId = org.id;

    const tenderResponse = await request(app)
      .post("/api/v1/tenders")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        tenderNumber: `TND-PROJ-${randomUUID().slice(0, 8)}`,
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
    tenderId = tenderResponse.body.data.id as string;

    for (const status of WON_TRANSITION_CHAIN) {
      const response = await request(app)
        .patch(`/api/v1/tenders/${tenderId}/status`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ status });
      expect(response.status).toBe(200);
    }
    const wonResponse = await request(app)
      .patch(`/api/v1/tenders/${tenderId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "WON", winnerName: "Us", winningBidAmount: 480000 });
    expect(wonResponse.status).toBe(200);
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
    await prisma.user.deleteMany({ where: { email } });
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
});
