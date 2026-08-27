import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { prisma } from "@bmp/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import { env } from "../../../config/env.js";
import {
  cleanupIntegrationTestUser,
  createIntegrationTestUser,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";

describe("Bills (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let token: string;
  let userId: string;
  let clientOrgId: string;
  let tenderId: string;
  let billId: string;
  let templatesDir: string;
  let businessCode: string;
  const TINY_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const originalBusinessesRootDir = env.BUSINESSES_ROOT_DIR;

  beforeAll(async () => {
    templatesDir = await mkdtemp(path.join(tmpdir(), "bmp-bills-integration-"));
    env.BUSINESSES_ROOT_DIR = templatesDir;

    testUser = await createIntegrationTestUser(app);
    token = testUser.accessToken;
    userId = testUser.userId;

    const business = await prisma.business.findUnique({
      where: { id: testUser.businessId },
      select: { code: true },
    });
    businessCode = business!.code;

    // Create signature file for PDF download test
    const businessTemplatesDir = path.join(templatesDir, businessCode, "templates");
    await mkdir(businessTemplatesDir, { recursive: true });
    await writeFile(path.join(businessTemplatesDir, "signature.png"), TINY_PNG);

    const client = await prisma.organization.create({
      data: { id: randomUUID(), name: "IISCO", type: "GOVERNMENT", createdById: userId },
    });
    clientOrgId = client.id;

    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: testUser.businessId,
        tenderNumber: `BILL-IT-${Date.now()}`,
        title: "Flange Slip Supply",
        clientId: clientOrgId,
        status: "WON",
        createdById: userId,
      },
    });
    tenderId = tender.id;
  });

  afterAll(async () => {
    if (billId) {
      await prisma.billItem.deleteMany({ where: { billId } });
      await prisma.bill.deleteMany({ where: { id: billId } });
    }
    if (tenderId) await prisma.tender.deleteMany({ where: { id: tenderId } });
    if (clientOrgId) await prisma.organization.deleteMany({ where: { id: clientOrgId } });
    await cleanupIntegrationTestUser(testUser);
    await rm(templatesDir, { recursive: true, force: true });
    env.BUSINESSES_ROOT_DIR = originalBusinessesRootDir;
    await prisma.$disconnect();
  });

  it("rejects a bill against a tender that is not WON", async () => {
    const notWon = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: testUser.businessId,
        tenderNumber: `BILL-IT-NOTWON-${Date.now()}`,
        title: "Not Won Tender",
        clientId: clientOrgId,
        status: "SUBMITTED",
        createdById: userId,
      },
    });

    const response = await request(app)
      .post("/api/v1/bills")
      .set("Authorization", `Bearer ${token}`)
      .send({ tenderId: notWon.id, items: [{ description: "Flange", quantity: 10, rate: 500 }] });

    expect(response.status).toBe(409);
    await prisma.tender.deleteMany({ where: { id: notWon.id } });
  });

  it("creates a bill against a WON tender, then lists and fetches it", async () => {
    const createResponse = await request(app)
      .post("/api/v1/bills")
      .set("Authorization", `Bearer ${token}`)
      .send({
        tenderId,
        grnNumber: "GRN-2201",
        grnDate: "2026-08-20",
        items: [{ description: "Flange Slip 6in", unit: "nos", quantity: 200, rate: 450 }],
      });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.total).toBe(90000);
    expect(createResponse.body.data.billNumber).toMatch(/^BILL-/);
    billId = createResponse.body.data.id;

    const listResponse = await request(app)
      .get("/api/v1/bills")
      .set("Authorization", `Bearer ${token}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.items.some((b: { id: string }) => b.id === billId)).toBe(true);

    const getResponse = await request(app)
      .get(`/api/v1/bills/${billId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data.grnNumber).toBe("GRN-2201");
    expect(getResponse.body.data.clientName).toBe("IISCO");
  });

  it("downloads the bill as a PDF", async () => {
    const response = await request(app)
      .get(`/api/v1/bills/${billId}/pdf`)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.body.length).toBeGreaterThan(0);
  });
});
