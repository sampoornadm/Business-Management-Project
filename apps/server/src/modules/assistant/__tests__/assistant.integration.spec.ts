import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import type { AssistantQueryResultDto } from "@bmp/types";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { generateJsonMock, generateTextMock } = vi.hoisted(() => ({
  generateJsonMock: vi.fn(),
  generateTextMock: vi.fn(),
}));
vi.mock("../../../infra/llm/ollama.client.js", () => ({
  generateJson: generateJsonMock,
  generateText: generateTextMock,
  embed: vi.fn().mockResolvedValue([[0, 0]]),
}));

import { createApp } from "../../../app.js";
import {
  cleanupIntegrationTestUser,
  createIntegrationTestUser,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";
import { resolveDatePhrase } from "../assistant.dates.js";

const DAY = 86_400_000;

describe("POST /assistant/query (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let clientId: string;
  const tenderIds: string[] = [];
  const rfqIds: string[] = [];
  const ids = {} as Record<"submittedWasher" | "wonWasher" | "oldBoqWasher" | "quotedTooEarly" | "quotationDocOnly" | "otherBusiness", string>;

  const post = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/assistant/query").set("Authorization", `Bearer ${testUser.accessToken}`).send(body);
  const resultIds = (r: { body: { data: AssistantQueryResultDto } }) => r.body.data.results.map((x) => x.id).sort();

  async function makeTender(opts: {
    key: keyof typeof ids;
    businessId: string;
    status: "DRAFT" | "SUBMITTED" | "WON";
    currentItem: string;
    oldItem?: string;
    submittedAt?: Date;
  }): Promise<string> {
    const id = randomUUID();
    await prisma.tender.create({
      data: {
        id,
        businessId: opts.businessId,
        tenderNumber: `ASSIST-${opts.key}-${Date.now()}`,
        title: `Assistant ${opts.key}`,
        clientId,
        status: opts.status,
        createdById: testUser.userId,
      },
    });
    tenderIds.push(id);
    ids[opts.key] = id;

    if (opts.oldItem) {
      const oldBoq = await prisma.boq.create({
        data: { id: randomUUID(), businessId: opts.businessId, tenderId: id, version: 1, isCurrent: false, createdById: testUser.userId },
      });
      await prisma.boqItem.create({ data: { boqId: oldBoq.id, description: opts.oldItem } });
    }
    const boq = await prisma.boq.create({
      data: { id: randomUUID(), businessId: opts.businessId, tenderId: id, version: opts.oldItem ? 2 : 1, isCurrent: true, createdById: testUser.userId },
    });
    await prisma.boqItem.create({ data: { boqId: boq.id, description: opts.currentItem } });

    if (opts.submittedAt) {
      await prisma.auditLog.create({
        data: {
          actorId: testUser.userId,
          action: "TENDER_STATUS_CHANGED",
          entityType: "Tender",
          entityId: id,
          metadata: { from: "DRAFT", to: "SUBMITTED" },
          createdAt: opts.submittedAt,
        },
      });
    }
    return id;
  }

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    const client = await prisma.organization.create({
      data: { id: randomUUID(), name: "Assistant Test Org", type: "GOVERNMENT", createdById: testUser.userId },
    });
    clientId = client.id;

    // Dates are relative to the real clock: the service resolves "last month" against it too.
    const lastMonth = resolveDatePhrase("last month", new Date(), "Asia/Kolkata")!.range;
    const inLastMonth = new Date(new Date(lastMonth.from).getTime() + 10 * DAY);
    const twoMonthsAgo = new Date(new Date(lastMonth.from).getTime() - 15 * DAY);

    await makeTender({ key: "submittedWasher", businessId: testUser.businessId, status: "SUBMITTED", currentItem: "Flat Washer M8", submittedAt: inLastMonth });
    await makeTender({ key: "wonWasher", businessId: testUser.businessId, status: "WON", currentItem: "Spring WASHERS 10mm", submittedAt: inLastMonth });
    // washer only in a superseded BOQ version — must not match
    await makeTender({ key: "oldBoqWasher", businessId: testUser.businessId, status: "SUBMITTED", currentItem: "Hex Bolt M8", oldItem: "Flat Washer M8", submittedAt: inLastMonth });
    // quoted, but two months ago — outside the range
    await makeTender({ key: "quotedTooEarly", businessId: testUser.businessId, status: "SUBMITTED", currentItem: "Flat Washer M8", submittedAt: twoMonthsAgo });
    // never moved to SUBMITTED, but a QUOTATION document was generated last month
    const docOnly = await makeTender({ key: "quotationDocOnly", businessId: testUser.businessId, status: "DRAFT", currentItem: "Plain washer 6mm" });
    await prisma.attachment.create({
      data: {
        originalName: "quotation.csv", storedName: `q-${randomUUID()}`, mimeType: "text/csv", sizeBytes: 10,
        hash: randomUUID(), storageBucket: "test", storagePath: `t/${randomUUID()}`, entityType: "Tender", entityId: docOnly,
        documentType: "QUOTATION", uploadedById: testUser.userId, createdAt: inLastMonth,
      },
    });
    // a different business entirely
    await makeTender({ key: "otherBusiness", businessId: testUser.secondBusinessId, status: "WON", currentItem: "Flat Washer M8", submittedAt: inLastMonth });

    const rfq = await prisma.rfq.create({
      data: { id: randomUUID(), businessId: testUser.businessId, title: "Assistant RFQ", createdById: testUser.userId },
    });
    rfqIds.push(rfq.id);
    await prisma.rfqItem.create({ data: { rfqId: rfq.id, description: "Washer, flat, zinc plated", quantity: 100 } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "Tender", entityId: { in: tenderIds } } });
    await prisma.rfq.deleteMany({ where: { id: { in: rfqIds } } });
    await prisma.attachment.deleteMany({ where: { entityId: { in: tenderIds } } });
    await prisma.tender.deleteMany({ where: { id: { in: tenderIds } } });
    await prisma.organization.deleteMany({ where: { id: clientId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    generateJsonMock.mockReset();
    generateTextMock.mockReset();
    generateJsonMock.mockImplementation(async (prompt: string) =>
      prompt.includes("Extract two things")
        ? { itemTerms: ["washers"], partyText: null }
        : { tenderNumber: null, documentType: null, freeTextQuery: "nothing" },
    );
  });

  describe("the washer conversation", () => {
    it("turn 1: tenders quoted last month for washers", async () => {
      const response = await post({ message: "show me which tenders I quoted last month for washers" });

      expect(response.status).toBe(200);
      const data = response.body.data as AssistantQueryResultDto;
      // submitted last month + won (both quoted last month) + the one with only a QUOTATION document.
      // Not: washer in an old BOQ version, quoted two months ago, or another business's tender.
      expect(resultIds(response)).toEqual(
        [ids.submittedWasher, ids.wonWasher, ids.quotationDocOnly].sort(),
      );
      expect(data.total).toBe(3);
      expect(data.results.every((r) => r.href === `/tenders/${r.id}`)).toBe(true);
      expect(data.results.find((r) => r.id === ids.submittedWasher)?.subtitle).toMatch(/Quoted .* · Item: Flat Washer M8/);
      expect(data.filters.map((f) => f.key)).toEqual(["entity", "itemTerms", "dateRange"]);
      expect(data.state).toMatchObject({ entity: "tender", itemTerms: ["washer"], dateField: "quoted" });
      expect(resultIds(response)).not.toContain(ids.otherBusiness);
    });

    it("turn 2: 'the ones which I won' refines the same query", async () => {
      const first = await post({ message: "show me which tenders I quoted last month for washers" });
      generateJsonMock.mockClear();

      const second = await post({ message: "show me the ones which I won", state: first.body.data.state });

      expect(second.status).toBe(200);
      expect(resultIds(second)).toEqual([ids.wonWasher]);
      expect(second.body.data.state).toMatchObject({ itemTerms: ["washer"], statuses: ["WON"], dateField: "quoted" });
      expect(second.body.data.filters.map((f: { label: string }) => f.label)).toContain("Status: Won");
      expect(generateJsonMock).not.toHaveBeenCalled(); // nothing left for the LLM to extract
    });

    it("dismissing the status chip widens it back", async () => {
      const first = await post({ message: "show me which tenders I quoted last month for washers" });
      const won = await post({ message: "the ones which I won", state: first.body.data.state });
      const widened = await post({ state: won.body.data.state, removeFilter: "statuses" });

      expect(widened.status).toBe(200);
      expect(resultIds(widened)).toEqual(resultIds(first));
    });
  });

  it("finds RFQs by item, linking to the RFQ page", async () => {
    const response = await post({ message: "RFQs for washers" });
    expect(response.status).toBe(200);
    const rfq = (response.body.data as AssistantQueryResultDto).results.find((r) => r.id === rfqIds[0]);
    expect(rfq).toMatchObject({ type: "Rfq", href: `/rfqs/${rfqIds[0]}` });
    expect(rfq?.subtitle).toContain("Item: Washer, flat, zinc plated");
  });

  it("searches every document kind when none is named", async () => {
    const response = await post({ message: "anything with washers" });
    const types = new Set((response.body.data as AssistantQueryResultDto).results.map((r) => r.type));
    expect(types).toContain("Tender");
    expect(types).toContain("Rfq");
  });

  it("still finds a tender by its number through the document search path", async () => {
    const number = (await prisma.tender.findUniqueOrThrow({ where: { id: ids.submittedWasher } })).tenderNumber;
    generateJsonMock.mockResolvedValue({ tenderNumber: number, documentType: "NIT", freeTextQuery: "tender notice" });
    generateTextMock.mockResolvedValue("Found it.");

    const response = await post({ message: `find the tender numbered ${number}` });

    expect(response.status).toBe(200);
    expect(response.body.data.state).toBeNull();
    expect(response.body.data.results.some((r: { type: string; id: string }) => r.type === "Tender" && r.id === ids.submittedWasher)).toBe(true);
  });

  it("rejects an empty message, a bare removeFilter, and a malformed state", async () => {
    expect((await post({ message: "" })).status).toBe(422);
    expect((await post({ removeFilter: "statuses" })).status).toBe(422);
    expect(
      (await post({ message: "x", state: { entity: "tender", itemTerms: [], statuses: [], dateField: "created", dateRange: null, partyText: null, extra: 1 } })).status,
    ).toBe(422);
    expect((await post({ message: "x", state: { entity: "user", itemTerms: [], statuses: [], dateField: "created", dateRange: null, partyText: null } })).status).toBe(422);
  });
});
