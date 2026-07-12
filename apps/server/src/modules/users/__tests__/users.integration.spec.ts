import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import type { Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import {
  createIntegrationTestUser,
  cleanupIntegrationTestUser,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";

/**
 * Requires a real Postgres + Redis reachable via .env.test, with migrations applied
 * (`pnpm db:migrate` against the test database). Run via `pnpm --filter @bmp/server test`
 * after `docker compose up`.
 */
describe("PATCH /users/me/theme-color (integration)", () => {
  const app: Express = createApp();
  let testUser: IntegrationTestUser;

  beforeEach(async () => {
    testUser = await createIntegrationTestUser(app);
  });

  afterEach(async () => {
    await cleanupIntegrationTestUser(testUser);
  });

  it("updates the theme color for a business the user belongs to", async () => {
    const response = await request(app)
      .patch("/api/v1/users/me/theme-color")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ businessId: testUser.businessId, themeColor: "teal" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const membership = await prisma.userBusiness.findUnique({
      where: { userId_businessId: { userId: testUser.userId, businessId: testUser.businessId } },
    });
    expect(membership?.themeColor).toBe("teal");
  });

  it("rejects an unknown themeColor value with 422", async () => {
    const response = await request(app)
      .patch("/api/v1/users/me/theme-color")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ businessId: testUser.businessId, themeColor: "not-a-real-color" });

    // The shared `validate(zod)` middleware (validate.middleware.ts) throws
    // UnprocessableEntityError for every schema failure app-wide — this endpoint
    // follows that same house convention, not a special case.
    expect(response.status).toBe(422);
  });

  it("rejects a businessId the user has no membership in with 404", async () => {
    const foreignBusiness = await prisma.business.create({
      data: { id: randomUUID(), name: "Foreign Business", code: `FB-${randomUUID().slice(0, 8)}` },
    });

    try {
      const response = await request(app)
        .patch("/api/v1/users/me/theme-color")
        .set("Authorization", `Bearer ${testUser.accessToken}`)
        .send({ businessId: foreignBusiness.id, themeColor: "teal" });

      expect(response.status).toBe(404);
    } finally {
      await prisma.business.deleteMany({ where: { id: foreignBusiness.id } });
    }
  });
});
