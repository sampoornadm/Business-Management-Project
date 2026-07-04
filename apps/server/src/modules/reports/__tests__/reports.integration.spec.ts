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
describe("Reports & search (integration)", () => {
  const app = createApp();
  const email = `reports-integration-${randomUUID()}@example.com`;
  const password = "Password123";
  let accessToken: string;
  let organizationId: string;
  let tenderId: string;

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
        firstName: "Reports",
        lastName: "Tester",
        roleId: role.id,
        isActive: true,
        isEmailVerified: true,
      },
    });

    const loginResponse = await request(app).post("/api/v1/auth/login").send({ email, password });
    accessToken = loginResponse.body.data.accessToken;

    const org = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: `Reports Integration Client ${randomUUID()}`,
        type: "GOVERNMENT",
        createdById: user.id,
      },
    });
    organizationId = org.id;

    const tenderResponse = await request(app)
      .post("/api/v1/tenders")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
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
      });
    tenderId = tenderResponse.body.data.id as string;
  });

  afterAll(async () => {
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { email } });
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
});
