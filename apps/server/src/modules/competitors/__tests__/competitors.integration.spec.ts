import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { prisma } from "@bmp/database";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import {
  cleanupIntegrationTestUser,
  createIntegrationTestUser,
  switchToSecondBusiness,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";
import { PortalLoginRequiredError } from "../../portal-bid/portal/comparative-grid.js";
import { statementSource } from "../competitors.module.js";

const fixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures", "comparative-1400000013.matrix.json"), "utf8"),
) as string[][];
const COIL = "20110601001260";

/** Requires the test Postgres + Redis (`docker compose up`, migrations applied to bmp_test). */
describe("competitor rates (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let organizationId: string;
  let tenderId: string;
  let openTenderId: string;
  // tenderNumber is unique across the table, so the fixture's RFQ number is swapped for a fresh one.
  const rfx = String(Math.floor(1_500_000_000 + Math.random() * 400_000_000));
  const matrix = () => fixture.map((row) => (row[0] === "R F Q No" ? [row[0], rfx, ...row.slice(2)] : [...row]));
  const originalRead = statementSource.read;

  const auth = () => ({ Authorization: `Bearer ${testUser.accessToken}` });
  const fetchStatement = (id = tenderId) =>
    request(app).post(`/api/v1/competitors/tenders/${id}/fetch-statement`).set(auth());

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    const org = await prisma.organization.create({
      data: { id: randomUUID(), name: `Statement Client ${randomUUID()}`, type: "GOVERNMENT", createdById: testUser.userId },
    });
    organizationId = org.id;
    const base = { clientId: organizationId, businessId: testUser.businessId, createdById: testUser.userId };
    const tender = await prisma.tender.create({
      data: { ...base, id: randomUUID(), tenderNumber: rfx, title: "Coil spring", status: "LOST" },
    });
    tenderId = tender.id;
    const open = await prisma.tender.create({
      data: { ...base, id: randomUUID(), tenderNumber: `${rfx}-B`, title: "Still open", status: "SUBMITTED" },
    });
    openTenderId = open.id;
    // Alpha's quotation reference in the fixture: this business bid as Alpha.
    await prisma.portalBid.create({
      data: { businessId: testUser.businessId, tenderId, portalCode: "SAIL_ISP", responseNumber: "8100000001" },
    });
    const boq = await prisma.boq.create({
      data: { id: randomUUID(), groupId: randomUUID(), businessId: testUser.businessId, tenderId, createdById: testUser.userId },
    });
    await prisma.boqItem.create({
      data: { boqId: boq.id, itemCode: COIL, description: "COIL SPRING,PSL-1397,MK-20", sortOrder: 0 },
    });
  });

  beforeEach(async () => {
    statementSource.read = () => Promise.resolve(matrix());
    await prisma.comparativeStatement.deleteMany({ where: { businessId: testUser.businessId } });
    await prisma.competitor.deleteMany({ where: { businessId: testUser.businessId } });
  });

  afterAll(async () => {
    statementSource.read = originalRead;
    await prisma.comparativeStatement.deleteMany({ where: { businessId: testUser.businessId } });
    await prisma.competitor.deleteMany({ where: { businessId: testUser.businessId } });
    await prisma.auditLog.deleteMany({ where: { entityId: tenderId } });
    await prisma.tender.deleteMany({ where: { id: { in: [tenderId, openTenderId] } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("stores the statement for a lost tender and serves it back", async () => {
    const response = await fetchStatement();
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      tenderId,
      bidders: 5,
      items: 1,
      lowestBidder: "BETA ENGINEERING CORPORATION",
      usFound: true,
    });

    const list = (await request(app).get("/api/v1/competitors").set(auth())).body.data as Array<{
      id: string;
      vendorCode: string;
      isSelf: boolean;
      tenderCount: number;
      lowestCount: number;
    }>;
    expect(list).toHaveLength(5);
    expect(list.find((c) => c.vendorCode === "1000000001")).toMatchObject({ isSelf: true, tenderCount: 1, lowestCount: 0 });
    const beta = list.find((c) => c.vendorCode === "1000000002")!;
    expect(beta).toMatchObject({ isSelf: false, lowestCount: 1 });

    const detail = (await request(app).get(`/api/v1/competitors/${beta.id}`).set(auth())).body.data;
    expect(detail.items[0]).toMatchObject({ itemCode: COIL, unit: "EA" });
    expect(detail.items[0].rates[0]).toMatchObject({
      tenderNumber: rfx,
      basicRate: 160,
      ourRate: 270,
      rank: 1,
      bidders: 5,
      lowestOverall: true,
    });

    const comparison = (await request(app).get(`/api/v1/competitors/items/${COIL}`).set(auth())).body.data;
    expect(comparison.columns[0].isSelf).toBe(true);
    expect(comparison.rows[0].lowestOverallCompetitorId).toBe(beta.id);
    expect(Object.values(comparison.rows[0].rates).sort()).toEqual([160, 170, 185, 270, 285]);

    const items = (await request(app).get("/api/v1/competitors/items?search=coil").set(auth())).body.data;
    expect(items).toEqual([
      { itemCode: COIL, description: "COIL SPRING,PSL-1397,MK-20", competitorCount: 5, tenderCount: 1 },
    ]);
  });

  it("links each rate to our BOQ line and keeps the raw grid", async () => {
    await fetchStatement();
    const statement = await prisma.comparativeStatement.findFirstOrThrow({
      where: { businessId: testUser.businessId, tenderId },
      include: { bids: { include: { items: true } } },
    });
    expect(statement.openedAt.toISOString()).toBe("2026-10-23T09:30:00.000Z");
    expect(statement.rawGrid).toEqual(matrix());
    expect(statement.bids.every((bid) => bid.items[0]!.boqItemId !== null)).toBe(true);
    expect(statement.bids.filter((bid) => bid.isUs).map((bid) => bid.quotationRef)).toEqual(["8100000001"]);
  });

  it("replaces, not duplicates, on a second fetch", async () => {
    await fetchStatement();
    await fetchStatement();
    const where = { businessId: testUser.businessId };
    expect(await prisma.competitor.count({ where })).toBe(5);
    expect(await prisma.comparativeStatement.count({ where })).toBe(1);
    expect(await prisma.comparativeBid.count({ where })).toBe(5);
    expect(await prisma.comparativeBidItem.count({ where })).toBe(5);
  });

  it("does not let a bidder who skipped an item be the lowest overall", async () => {
    const basic = fixture.findIndex((row) => row[0] === "Basic Price Per Unit");
    statementSource.read = () => Promise.resolve(matrix().map((row, i) => (i === basic ? row.map((cell, c) => (c === 2 ? "" : cell)) : row)));
    const response = await fetchStatement();
    expect(response.body.data.lowestBidder).toBe("DELTA ENTERPRISES");
  });

  it("keeps our firm marked on a later tender that has no saved portal bid", async () => {
    await fetchStatement();
    await prisma.portalBid.deleteMany({ where: { tenderId } });
    const response = await fetchStatement();
    expect(response.body.data.usFound).toBe(true);
    await prisma.portalBid.create({
      data: { businessId: testUser.businessId, tenderId, portalCode: "SAIL_ISP", responseNumber: "8100000001" },
    });
  });

  it("stores nothing and says so when the portal needs a login", async () => {
    statementSource.read = () => Promise.reject(new PortalLoginRequiredError());
    const response = await fetchStatement();
    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/Log in to the portal/);
    expect(await prisma.comparativeStatement.count({ where: { businessId: testUser.businessId } })).toBe(0);
  });

  it("stores nothing when the grid cannot be read as a statement", async () => {
    statementSource.read = () => Promise.resolve([["Menu", "x"]]);
    const response = await fetchStatement();
    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/Nothing was saved/);
    expect(await prisma.comparativeStatement.count({ where: { businessId: testUser.businessId } })).toBe(0);
  });

  it("stores nothing when the statement is for another RFx", async () => {
    statementSource.read = () => Promise.resolve(fixture);
    const response = await fetchStatement();
    expect(response.status).toBe(400);
    expect(await prisma.comparativeStatement.count({ where: { businessId: testUser.businessId } })).toBe(0);
  });

  it("refuses a tender whose result is not in yet, without touching the portal", async () => {
    let reads = 0;
    statementSource.read = () => {
      reads += 1;
      return Promise.resolve(matrix());
    };
    const response = await fetchStatement(openTenderId);
    expect(response.status).toBe(400);
    expect(reads).toBe(0);
  });

  it("gives rates to beat for a tender's BOQ items, leaving out its own statement", async () => {
    await fetchStatement();
    const own = (await request(app).get(`/api/v1/competitors/tenders/${tenderId}/rates-to-beat`).set(auth())).body.data;
    expect(own.items).toEqual([{ itemCode: COIL, rateToBeat: null, bidders: [], us: null }]);
  });

  it("marks and unmarks a competitor as our own firm", async () => {
    await fetchStatement();
    const beta = await prisma.competitor.findFirstOrThrow({
      where: { businessId: testUser.businessId, vendorCode: "1000000002" },
    });
    const response = await request(app).patch(`/api/v1/competitors/${beta.id}`).set(auth()).send({ isSelf: true });
    expect(response.status).toBe(200);
    expect(response.body.data.isSelf).toBe(true);
    expect(await prisma.comparativeBid.count({ where: { businessId: testUser.businessId, competitorId: beta.id, isUs: true } })).toBe(1);
  });

  it("hides one business's competitors from another", async () => {
    await fetchStatement();
    const otherToken = await switchToSecondBusiness(app, testUser);
    const other = { Authorization: `Bearer ${otherToken}` };
    expect((await request(app).get("/api/v1/competitors").set(other)).body.data).toEqual([]);
    expect((await request(app).get(`/api/v1/competitors/items/${COIL}`).set(other)).status).toBe(404);
    expect((await request(app).post(`/api/v1/competitors/tenders/${tenderId}/fetch-statement`).set(other)).status).toBe(404);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/v1/competitors")).status).toBe(401);
  });
});
