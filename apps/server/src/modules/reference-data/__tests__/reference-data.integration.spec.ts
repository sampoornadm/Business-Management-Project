import { prisma } from "@bmp/database";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import {
  cleanupIntegrationTestUser,
  createIntegrationTestUser,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";

/**
 * Requires a real Postgres + Redis + MinIO reachable via .env.test
 * (`pnpm db:migrate` against the test database, `docker compose up`).
 *
 * Uses an obviously-fake HSN code ("TEST") rather than a real one (e.g. "7307") so this test
 * never collides with the real CBIC data already seeded in the test database — upserting over a
 * real code with a differing description would clear that row's embeddedAt as a side effect of
 * running this test, silently de-embedding production-meaningful reference data.
 */
describe("Reference data HSN/SAC upload (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let accessToken: string;

  async function buildFixtureWorkbook(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const hsn = workbook.addWorksheet("HSN_MSTR");
    hsn.addRow(["HSN_CD", "HSN_Description"]);
    hsn.addRow(["TEST", "INTEGRATION TEST FIXTURE ROW"]);
    workbook.addWorksheet("SAC_MSTR").addRow(["SAC_CD", "SAC_Description"]);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    accessToken = testUser.accessToken;
  });

  afterAll(async () => {
    await prisma.hsnCode.deleteMany({ where: { code: "TEST" } });
    await prisma.referenceDataImport.deleteMany({ where: { sourceUrl: { startsWith: "upload:" } } });
    await cleanupIntegrationTestUser(testUser);
  });

  it("uploads a fixture workbook and makes it show up in status", async () => {
    const buffer = await buildFixtureWorkbook();

    const uploadRes = await request(app)
      .post("/api/v1/reference-data/hsn-sac/upload")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("file", buffer, "HSN_SAC.xlsx");
    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.data.hsnRowCount).toBe(1);

    const statusRes = await request(app)
      .get("/api/v1/reference-data/hsn-sac/status")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.hsnRowCount).toBe(1);

    const stored = await prisma.hsnCode.findUnique({ where: { code: "TEST" } });
    expect(stored?.description).toBe("INTEGRATION TEST FIXTURE ROW");
  });
});
