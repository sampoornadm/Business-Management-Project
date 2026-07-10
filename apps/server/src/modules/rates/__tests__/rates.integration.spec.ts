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
describe("Rates business isolation (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
  });

  afterAll(async () => {
    const businessIds = [testUser.businessId, testUser.secondBusinessId];
    await prisma.historicalRate.deleteMany({ where: { businessId: { in: businessIds } } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("does not return a historical rate from another business in list or suggest", async () => {
    const itemName = `Isolation Cement ${randomUUID().slice(0, 8)}`;
    const createResponse = await request(app)
      .post("/api/v1/rates")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({
        category: "MATERIAL",
        itemName,
        unit: "bag",
        rate: 380,
        effectiveDate: "2026-01-01",
      });
    expect(createResponse.status).toBe(201);
    const isolationRateId = createResponse.body.data.id as string;

    const secondBusinessToken = await switchToSecondBusiness(app, testUser);

    const listResponse = await request(app)
      .get("/api/v1/rates")
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.map((r: { id: string }) => r.id)).not.toContain(isolationRateId);

    const suggestResponse = await request(app)
      .get("/api/v1/rates/suggest")
      .query({ category: "MATERIAL", itemName })
      .set("Authorization", `Bearer ${secondBusinessToken}`);
    expect(suggestResponse.status).toBe(200);
    expect(suggestResponse.body.data.map((r: { id: string }) => r.id)).not.toContain(isolationRateId);

    const firstBusinessListResponse = await request(app)
      .get("/api/v1/rates")
      .set("Authorization", `Bearer ${testUser.accessToken}`);
    expect(firstBusinessListResponse.status).toBe(200);
    expect(firstBusinessListResponse.body.data.map((r: { id: string }) => r.id)).toContain(isolationRateId);
  });
});
