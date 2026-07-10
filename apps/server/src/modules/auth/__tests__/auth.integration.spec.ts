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
  let userId: string;
  let firstBusinessId: string;
  let secondBusinessId: string;
  let accessToken: string;

  beforeAll(async () => {
    const role = await prisma.role.upsert({
      where: { name: "VIEWER" },
      update: {},
      create: { id: randomUUID(), name: "VIEWER", description: "Viewer", isSystem: true },
    });
    roleId = role.id;

    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email,
        passwordHash: await hashPassword(password),
        firstName: "Integration",
        lastName: "Test",
        isActive: true,
        isEmailVerified: true,
      },
    });
    userId = user.id;

    const firstBusiness = await prisma.business.create({
      data: { id: randomUUID(), name: "Integration First Business", code: `IFB-${randomUUID().slice(0, 8)}` },
    });
    firstBusinessId = firstBusiness.id;

    const secondBusiness = await prisma.business.create({
      data: { id: randomUUID(), name: "Integration Second Business", code: `ISB-${randomUUID().slice(0, 8)}` },
    });
    secondBusinessId = secondBusiness.id;

    await prisma.userBusiness.createMany({
      data: [
        { id: randomUUID(), userId, businessId: firstBusinessId, roleId },
        { id: randomUUID(), userId, businessId: secondBusinessId, roleId },
      ],
    });

    const loginResponse = await request(app).post("/api/v1/auth/login").send({ email, password });
    accessToken = loginResponse.body.data.accessToken as string;
  });

  afterAll(async () => {
    // Cascades to UserBusiness/RefreshToken rows for this user (both FKs are onDelete: Cascade).
    await prisma.user.deleteMany({ where: { email } });
    await prisma.business.deleteMany({ where: { id: { in: [firstBusinessId, secondBusinessId] } } });
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

  it("switches active business and reflects it in the new access token", async () => {
    const switchResponse = await request(app)
      .post("/api/v1/auth/switch-business")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ businessId: secondBusinessId });

    expect(switchResponse.status).toBe(200);
    expect(switchResponse.body.success).toBe(true);
    expect(switchResponse.headers["set-cookie"]?.[0]).toMatch(/refreshToken=/);

    const newToken = switchResponse.body.data.accessToken as string;
    expect(newToken).toBeTruthy();
    const decoded = JSON.parse(Buffer.from(newToken.split(".")[1]!, "base64").toString());
    expect(decoded.businessId).toBe(secondBusinessId);
  });

  it("rejects switching to a business the user doesn't belong to", async () => {
    const response = await request(app)
      .post("/api/v1/auth/switch-business")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ businessId: randomUUID() });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });
});
