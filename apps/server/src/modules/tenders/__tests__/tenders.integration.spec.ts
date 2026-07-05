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
describe("Tender workflow (integration)", () => {
  const app = createApp();
  const email = `tender-integration-${randomUUID()}@example.com`;
  const password = "Password123";
  let accessToken: string;
  let userId: string;
  let organizationId: string;

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
        firstName: "Tender",
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
        name: `Integration Client ${randomUUID()}`,
        type: "GOVERNMENT",
        createdById: user.id,
      },
    });
    organizationId = org.id;
  });

  afterAll(async () => {
    await prisma.tender.deleteMany({ where: { createdById: userId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("creates a tender, advances its status through valid transitions, and records history", async () => {
    const createResponse = await request(app)
      .post("/api/v1/tenders")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        tenderNumber: `TND-${randomUUID().slice(0, 8)}`,
        title: "Integration Test Tender",
        department: "PWD",
        clientId: organizationId,
        type: "OPEN",
        category: "ROAD",
        location: "Test City",
        state: "Test State",
        estimatedCost: 500000,
        submissionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });

    expect(createResponse.status).toBe(201);
    const tenderId = createResponse.body.data.id as string;
    expect(createResponse.body.data.status).toBe("DRAFT");

    const firstTransition = await request(app)
      .patch(`/api/v1/tenders/${tenderId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "SUBMITTED" });
    expect(firstTransition.status).toBe(200);
    expect(firstTransition.body.data.status).toBe("SUBMITTED");

    const secondTransition = await request(app)
      .patch(`/api/v1/tenders/${tenderId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "WON" });
    expect(secondTransition.status).toBe(200);
    expect(secondTransition.body.data.status).toBe("WON");

    const illegalTransition = await request(app)
      .patch(`/api/v1/tenders/${tenderId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "CANCELLED" });
    expect(illegalTransition.status).toBe(400);

    const historyResponse = await request(app)
      .get(`/api/v1/tenders/${tenderId}/status-history`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(historyResponse.status).toBe(200);

    const entries = historyResponse.body.data.items as Array<{ toStatus: string }>;
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.toStatus)).toEqual(["WON", "SUBMITTED"]);
  });

  it("rejects deleting a tender that is no longer in Draft status", async () => {
    const createResponse = await request(app)
      .post("/api/v1/tenders")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        tenderNumber: `TND-${randomUUID().slice(0, 8)}`,
        title: "Non-deletable Tender",
        department: "PWD",
        clientId: organizationId,
        type: "OPEN",
        category: "ROAD",
        location: "Test City",
        state: "Test State",
        estimatedCost: 250000,
        submissionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
    const tenderId = createResponse.body.data.id as string;

    await request(app)
      .patch(`/api/v1/tenders/${tenderId}/status`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ status: "SUBMITTED" });

    const deleteResponse = await request(app)
      .delete(`/api/v1/tenders/${tenderId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(deleteResponse.status).toBe(409);
  });
});
