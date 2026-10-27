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

/** Requires the test Postgres + Redis (`docker compose up`, migrations applied to bmp_test). */
describe("GET /portal-bids/by-response/:responseNumber (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let organizationId: string;
  let tenderId: string;
  const tenderNumber = `TND-${randomUUID().slice(0, 8)}`;
  const responseNumber = String(Math.floor(8_000_000_000 + Math.random() * 1_000_000_000));

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    const org = await prisma.organization.create({
      data: { id: randomUUID(), name: `Portal Client ${randomUUID()}`, type: "GOVERNMENT", createdById: testUser.userId },
    });
    organizationId = org.id;
    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        tenderNumber,
        title: "Portal bid lookup",
        clientId: organizationId,
        businessId: testUser.businessId,
        createdById: testUser.userId,
      },
    });
    tenderId = tender.id;
    await prisma.portalBid.create({
      data: { businessId: testUser.businessId, tenderId, portalCode: "SAIL_ISP", responseNumber },
    });
  });

  afterAll(async () => {
    await prisma.portalBid.deleteMany({ where: { tenderId } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("resolves a portal response number to its tender", async () => {
    const response = await request(app)
      .get(`/api/v1/portal-bids/by-response/${responseNumber}`)
      .set("Authorization", `Bearer ${testUser.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ tenderId, tenderNumber, status: "SAVED" });
  });

  it("returns 404 for a response number nobody filed", async () => {
    const response = await request(app)
      .get("/api/v1/portal-bids/by-response/1")
      .set("Authorization", `Bearer ${testUser.accessToken}`);
    expect(response.status).toBe(404);
  });

  it("requires authentication", async () => {
    const response = await request(app).get(`/api/v1/portal-bids/by-response/${responseNumber}`);
    expect(response.status).toBe(401);
  });
});
