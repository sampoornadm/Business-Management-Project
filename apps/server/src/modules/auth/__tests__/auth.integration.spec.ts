import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import { hashPassword } from "../../../shared/utils/hash.js";

/**
 * Requires a real Postgres + Redis reachable via the DATABASE_URL / REDIS_URL
 * in .env.test, with migrations applied (`pnpm db:migrate` against the test
 * database). Run via `pnpm --filter @bmp/server test` after `docker compose up`.
 */
describe("Auth flow (integration)", () => {
  const app = createApp();
  const email = `integration-${randomUUID()}@example.com`;
  const password = "Password123";
  let roleId: string;

  beforeAll(async () => {
    const role = await prisma.role.upsert({
      where: { name: "VIEWER" },
      update: {},
      create: { id: randomUUID(), name: "VIEWER", description: "Viewer", isSystem: true },
    });
    roleId = role.id;

    await prisma.user.create({
      data: {
        id: randomUUID(),
        email,
        passwordHash: await hashPassword(password),
        firstName: "Integration",
        lastName: "Test",
        roleId,
        isActive: true,
        isEmailVerified: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("logs in and returns an access token plus a refresh cookie", async () => {
    const response = await request(app).post("/api/v1/auth/login").send({ email, password });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.headers["set-cookie"]?.[0]).toMatch(/refreshToken=/);
  });

  it("rejects an invalid password", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: "WrongPassword1" });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it("rejects unauthenticated access to a protected route", async () => {
    const response = await request(app).get("/api/v1/users/me");
    expect(response.status).toBe(401);
  });
});
