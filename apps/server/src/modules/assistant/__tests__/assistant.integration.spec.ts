import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

describe("POST /assistant/query (integration)", () => {
  const app = createApp();
  let testUser: IntegrationTestUser;
  let tenderId: string;
  let clientId: string;

  beforeAll(async () => {
    testUser = await createIntegrationTestUser(app);
    const client = await prisma.organization.create({
      data: { id: randomUUID(), name: "Assistant Test Org", type: "GOVERNMENT", createdById: testUser.userId },
    });
    clientId = client.id;
    const tender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: testUser.businessId,
        tenderNumber: `ASSISTANT-IT-${Date.now()}`,
        title: "Assistant Test Tender",
        clientId: client.id,
        status: "DRAFT",
        createdById: testUser.userId,
      },
    });
    tenderId = tender.id;
  });

  afterAll(async () => {
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.organization.deleteMany({ where: { id: clientId } });
    await cleanupIntegrationTestUser(testUser);
    await prisma.$disconnect();
  });

  it("finds a tender by natural-language message referencing its number", async () => {
    generateJsonMock.mockResolvedValue({
      tenderNumber: null,
      documentType: null,
      freeTextQuery: tenderId, // not realistic LLM output, but exercises the real search fallback path
    });
    generateTextMock.mockResolvedValue("Found it.");

    const response = await request(app)
      .post("/api/v1/assistant/query")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ message: `find tender ${tenderId}` });

    expect(response.status).toBe(200);
    expect(typeof response.body.data.reply).toBe("string");
    expect(Array.isArray(response.body.data.results)).toBe(true);
  });

  it("rejects an empty message with a validation error", async () => {
    const response = await request(app)
      .post("/api/v1/assistant/query")
      .set("Authorization", `Bearer ${testUser.accessToken}`)
      .send({ message: "" });

    expect(response.status).toBe(422);
  });
});
