import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { WILDCARD_PERMISSION } from "@bmp/types";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import { hashPassword } from "../../../shared/utils/hash.js";

/**
 * Requires a real Postgres + Redis + MinIO reachable via .env.test
 * (`pnpm db:migrate` against the test database, `docker compose up`).
 */
describe("BOQ upload/commit workflow (integration)", () => {
  const app = createApp();
  const email = `boq-integration-${randomUUID()}@example.com`;
  const password = "Password123";
  let accessToken: string;
  let userId: string;
  let organizationId: string;
  let tenderId: string;

  async function buildFixtureXlsx(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("BOQ");
    sheet.addRow(["Item Code", "Description", "Unit", "Quantity", "Rate"]);
    sheet.addRow(["1", "Excavation", "cum", 100, 50]);
    sheet.addRow(["2", "Backfilling", "cum", 40, 20]);
    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

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
        firstName: "Boq",
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
        name: `BOQ Integration Client ${randomUUID()}`,
        type: "GOVERNMENT",
        createdById: user.id,
      },
    });
    organizationId = org.id;

    const tenderResponse = await request(app)
      .post("/api/v1/tenders")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        tenderNumber: `TND-BOQ-${randomUUID().slice(0, 8)}`,
        title: "BOQ Integration Tender",
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
    await prisma.boq.deleteMany({ where: { tenderId } });
    await prisma.attachment.deleteMany({ where: { uploadedById: userId } });
    await prisma.tender.deleteMany({ where: { createdById: userId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("uploads and parses a BOQ Excel file into a mapping preview", async () => {
    const buffer = await buildFixtureXlsx();

    const response = await request(app)
      .post(`/api/v1/tenders/${tenderId}/boq/parse`)
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", buffer, "fixture.xlsx");

    expect(response.status).toBe(200);
    expect(response.body.data.rows).toHaveLength(2);
    expect(response.body.data.suggestedMapping.description).toBe("Description");
    expect(response.body.data.suggestedMapping.rate).toBe("Rate");
  });

  it("commits parsed rows, then fetches back a matching item tree", async () => {
    const commitResponse = await request(app)
      .post(`/api/v1/tenders/${tenderId}/boq`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        items: [
          { tempId: "1", description: "Excavation", unit: "cum", quantity: 100, rate: 50 },
          { tempId: "2", description: "Backfilling", unit: "cum", quantity: 40, rate: 20 },
        ],
      });

    expect(commitResponse.status).toBe(201);
    expect(commitResponse.body.data.totalAmount).toBe(5800);
    expect(commitResponse.body.data.version).toBe(1);

    const getResponse = await request(app)
      .get(`/api/v1/tenders/${tenderId}/boq`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data.items).toHaveLength(2);
    expect(getResponse.body.data.totalAmount).toBe(5800);
  });

  it("creates a second version via replacesBoqId and lists both versions", async () => {
    const current = await request(app)
      .get(`/api/v1/tenders/${tenderId}/boq`)
      .set("Authorization", `Bearer ${accessToken}`);
    const firstBoqId = current.body.data.id as string;

    const secondCommit = await request(app)
      .post(`/api/v1/tenders/${tenderId}/boq`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        replacesBoqId: firstBoqId,
        items: [{ tempId: "1", description: "Excavation", unit: "cum", quantity: 100, rate: 55 }],
      });
    expect(secondCommit.status).toBe(201);
    expect(secondCommit.body.data.version).toBe(2);

    const versions = await request(app)
      .get(`/api/v1/tenders/${tenderId}/boq/versions`)
      .set("Authorization", `Bearer ${accessToken}`);
    expect(versions.status).toBe(200);
    expect(versions.body.data).toHaveLength(2);
    expect(versions.body.data.find((v: { version: number }) => v.version === 2).isCurrent).toBe(true);
    expect(versions.body.data.find((v: { version: number }) => v.version === 1).isCurrent).toBe(false);
  });
});
