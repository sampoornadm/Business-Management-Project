import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchResultsDto } from "@bmp/types";

const { generateJsonMock, generateTextMock } = vi.hoisted(() => ({
  generateJsonMock: vi.fn(),
  generateTextMock: vi.fn(),
}));
vi.mock("../../../infra/llm/ollama.client.js", () => ({
  generateJson: generateJsonMock,
  generateText: generateTextMock,
}));

import { ServiceUnavailableError } from "../../../core/errors/HttpErrors.js";
import { AssistantService } from "../assistant.service.js";

function fakeSearchService(result: SearchResultsDto) {
  return { search: vi.fn().mockResolvedValue(result) };
}

describe("AssistantService", () => {
  const businessId = randomUUID();

  beforeEach(() => {
    generateJsonMock.mockReset();
    generateTextMock.mockReset();
  });

  it("uses the LLM-extracted tender number to build the search query", async () => {
    generateJsonMock.mockResolvedValue({
      tenderNumber: "TST-1783835577-Sam",
      documentType: "BILL",
      freeTextQuery: "bill",
    });
    generateTextMock.mockResolvedValue("Found it — here's the bill.");
    const searchResult: SearchResultsDto = {
      query: "TST-1783835577-Sam",
      results: [{ type: "Attachment", id: randomUUID(), title: "BILL-ABC.pdf", subtitle: "TST-1783835577-Sam", href: "/tenders/1?tab=documents" }],
    };
    const search = fakeSearchService(searchResult);
    const service = new AssistantService(search as never);

    const result = await service.query("find me the bill for tender TST-1783835577-Sam", businessId);

    expect(search.search).toHaveBeenCalledWith(businessId, expect.stringContaining("TST-1783835577-Sam"));
    expect(result.reply).toBe("Found it — here's the bill.");
    expect(result.results).toEqual(searchResult.results);
  });

  it("falls back to the raw message when Ollama can't parse intent", async () => {
    generateJsonMock.mockRejectedValue(new ServiceUnavailableError("Ollama not reachable"));
    generateTextMock.mockRejectedValue(new ServiceUnavailableError("Ollama not reachable"));
    const searchResult: SearchResultsDto = { query: "undertaking for TND-9", results: [] };
    const search = fakeSearchService(searchResult);
    const service = new AssistantService(search as never);

    const result = await service.query("undertaking for TND-9", businessId);

    expect(search.search).toHaveBeenCalledWith(businessId, "undertaking for TND-9");
    expect(result.reply).toBe("Nothing found matching that.");
  });

  it("replies with a deterministic message when nothing is found", async () => {
    generateJsonMock.mockResolvedValue({ tenderNumber: null, documentType: null, freeTextQuery: "xyz" });
    const search = fakeSearchService({ query: "xyz", results: [] });
    const service = new AssistantService(search as never);

    const result = await service.query("xyz", businessId);

    expect(result.reply).toBe("Nothing found matching that.");
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});
