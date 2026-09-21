import { randomUUID } from "node:crypto";

import type { AssistantQueryState, SearchResultsDto } from "@bmp/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateJsonMock, generateTextMock } = vi.hoisted(() => ({
  generateJsonMock: vi.fn(),
  generateTextMock: vi.fn(),
}));
vi.mock("../../../infra/llm/ollama.client.js", () => ({
  generateJson: generateJsonMock,
  generateText: generateTextMock,
}));

import { ServiceUnavailableError } from "../../../core/errors/HttpErrors.js";
import type { AssistantHit, AssistantKindResult, IAssistantRepository } from "../assistant.repository.js";
import { AssistantService } from "../assistant.service.js";
import type { ExtractedTerms } from "../assistant.terms.js";

const NOW = new Date("2026-09-22T10:00:00Z");
const businessId = randomUUID();
const caller = { roleId: randomUUID(), businessId };

const tenderHit = (over: Partial<AssistantHit> = {}): AssistantHit => ({
  type: "Tender",
  id: "t1",
  title: "Switchgear supply",
  reference: "TND-2041",
  status: "SUBMITTED",
  dateLabel: "Quoted",
  date: new Date("2026-08-12T05:00:00Z"),
  party: "Meridian Power Grid Ltd.",
  matchedItem: "Flat Washer M8",
  ...over,
});

function fakeRepository(result: Partial<Record<"tender" | "rfq" | "purchase_order" | "bill", AssistantKindResult>> = {}) {
  const empty: AssistantKindResult = { total: 0, hits: [] };
  return {
    findTenders: vi.fn().mockResolvedValue(result.tender ?? empty),
    findRfqs: vi.fn().mockResolvedValue(result.rfq ?? empty),
    findPurchaseOrders: vi.fn().mockResolvedValue(result.purchase_order ?? empty),
    findBills: vi.fn().mockResolvedValue(result.bill ?? empty),
  } satisfies IAssistantRepository;
}

const terms = (itemTerms: string[], partyText: string | null = null): ExtractedTerms => ({ itemTerms, partyText, source: "llm" });

function build(
  repository: IAssistantRepository,
  opts: { extract?: ReturnType<typeof vi.fn>; search?: ReturnType<typeof vi.fn>; permitted?: (key: string) => boolean } = {},
) {
  const search = opts.search ?? vi.fn().mockResolvedValue({ query: "", results: [] });
  const extract = opts.extract ?? vi.fn().mockResolvedValue(terms([]));
  const hasPermission = vi.fn(async (_role: string, key: string) => (opts.permitted ? opts.permitted(key) : true));
  const service = new AssistantService({ search } as never, repository, hasPermission, {
    now: () => NOW,
    timezone: "Asia/Kolkata",
    extract: extract as never,
  });
  return { service, search, extract, hasPermission };
}

describe("AssistantService — structured queries", () => {
  beforeEach(() => {
    generateJsonMock.mockReset();
    generateTextMock.mockReset();
  });

  it("answers 'tenders I quoted last month for washers' with links and chips", async () => {
    const repo = fakeRepository({ tender: { total: 1, hits: [tenderHit()] } });
    const { service, extract } = build(repo, { extract: vi.fn().mockResolvedValue(terms(["washer"])) });

    const result = await service.query({ message: "show me which tenders I quoted last month for washers" }, caller);

    expect(extract).toHaveBeenCalledOnce();
    const [state, biz, limit] = repo.findTenders.mock.calls[0]!;
    expect(state).toMatchObject({ entity: "tender", itemTerms: ["washer"], statuses: [], dateField: "quoted" });
    expect(state.dateRange.label).toBe("last month (August 2026)");
    expect([biz, limit]).toEqual([businessId, 25]);

    expect(result.reply).toBe("Found 1 tender (Item: washer · Quoted: last month (August 2026)).");
    expect(result.total).toBe(1);
    expect(result.results).toEqual([
      {
        type: "Tender",
        id: "t1",
        title: "Switchgear supply",
        subtitle: "TND-2041 · Submitted · Quoted 12 Aug 2026 · Item: Flat Washer M8 · Meridian Power Grid Ltd.",
        href: "/tenders/t1",
      },
    ]);
    expect(result.filters.map((c) => c.label)).toEqual(["Tenders", "Item: washer", "Quoted: last month (August 2026)"]);
    expect(result.state).toMatchObject({ entity: "tender", itemTerms: ["washer"] });
    // only tenders were queried
    expect(repo.findRfqs).not.toHaveBeenCalled();
  });

  it("follow-up 'the ones which I won' refines the echoed state and re-queries", async () => {
    const repo = fakeRepository({ tender: { total: 1, hits: [tenderHit({ status: "WON" })] } });
    const { service, extract } = build(repo, { extract: vi.fn().mockResolvedValue(terms(["washer"])) });
    const first = await service.query({ message: "show me which tenders I quoted last month for washers" }, caller);

    extract.mockResolvedValue(terms([])); // the follow-up names no item
    const second = await service.query({ message: "show me the ones which I won", state: first.state }, caller);

    const secondState = repo.findTenders.mock.calls[1]![0] as AssistantQueryState;
    expect(secondState).toEqual({ ...first.state!, statuses: ["WON"] });
    expect(second.filters.map((c) => c.label)).toEqual([
      "Tenders",
      "Item: washer",
      "Status: Won",
      "Quoted: last month (August 2026)",
    ]);
    expect(second.state?.statuses).toEqual(["WON"]);
  });

  it("skips the LLM when the message names no item or party", async () => {
    const repo = fakeRepository({ tender: { total: 0, hits: [] } });
    const { service, extract } = build(repo);
    const prior: AssistantQueryState = {
      entity: "tender", itemTerms: ["washer"], statuses: [], dateField: "created", dateRange: null, partyText: null,
    };
    await service.query({ message: "the ones which I won", state: prior }, caller);
    expect(extract).not.toHaveBeenCalled();
  });

  it("chip dismissal re-runs without that filter and without interpreting anything", async () => {
    const repo = fakeRepository({ tender: { total: 2, hits: [tenderHit(), tenderHit({ id: "t2" })] } });
    const { service, extract } = build(repo);
    const state: AssistantQueryState = {
      entity: "tender", itemTerms: ["washer"], statuses: ["WON"], dateField: "quoted",
      dateRange: { from: "2026-07-31T18:30:00.000Z", to: "2026-08-31T18:30:00.000Z", label: "last month" }, partyText: null,
    };
    const result = await service.query({ state, removeFilter: "statuses" }, caller);
    expect(extract).not.toHaveBeenCalled();
    expect((repo.findTenders.mock.calls[0]![0] as AssistantQueryState).statuses).toEqual([]);
    expect(result.state?.statuses).toEqual([]);
    expect(result.total).toBe(2);
  });

  it("queries every permitted kind when none is named, and skips kinds a status cannot apply to", async () => {
    const repo = fakeRepository({
      tender: { total: 1, hits: [tenderHit()] },
      rfq: { total: 1, hits: [{ ...tenderHit(), type: "Rfq", id: "r1", title: "RFQ washers", reference: null, status: "SENT", party: null }] },
    });
    const { service } = build(repo, { extract: vi.fn().mockResolvedValue(terms(["washer"])) });

    const all = await service.query({ message: "anything with washers" }, caller);
    expect(repo.findTenders).toHaveBeenCalled();
    expect(repo.findRfqs).toHaveBeenCalled();
    expect(repo.findPurchaseOrders).toHaveBeenCalled();
    expect(repo.findBills).toHaveBeenCalled();
    expect(repo.findTenders.mock.calls[0]![2]).toBe(10); // mixed-kind cap
    expect(all.reply).toBe("Found 2 documents: 1 tender, 1 RFQ (Item: washer).");

    repo.findTenders.mockClear();
    repo.findRfqs.mockClear();
    const won = await service.query({ message: "the ones I won", state: all.state }, caller);
    expect(won.state?.entity).toBe("tender"); // "won" can only mean tenders
    expect(repo.findTenders).toHaveBeenCalled();
    expect(repo.findRfqs).not.toHaveBeenCalled();
  });

  it("never runs a kind the caller may not read", async () => {
    const repo = fakeRepository();
    const { service } = build(repo, {
      extract: vi.fn().mockResolvedValue(terms(["washer"])),
      permitted: (key) => key !== "bills:read" && key !== "rfq:read",
    });

    const mixed = await service.query({ message: "anything with washers" }, caller);
    expect(repo.findBills).not.toHaveBeenCalled();
    expect(repo.findRfqs).not.toHaveBeenCalled();
    expect(repo.findTenders).toHaveBeenCalled();
    expect(mixed.reply).toContain("No access to RFQs, bills");

    const denied = await service.query({ message: "show me RFQs for washers" }, caller);
    expect(repo.findRfqs).not.toHaveBeenCalled();
    expect(denied.results).toEqual([]);
    expect(denied.reply).toBe("You don't have access to RFQs.");
  });

  it("says when the list is capped", async () => {
    const hits = Array.from({ length: 25 }, (_, i) => tenderHit({ id: `t${i}` }));
    const repo = fakeRepository({ tender: { total: 40, hits } });
    const { service } = build(repo, { extract: vi.fn().mockResolvedValue(terms(["washer"])) });
    const result = await service.query({ message: "tenders for washers" }, caller);
    expect(result.results).toHaveLength(25);
    expect(result.total).toBe(40);
    expect(result.reply).toContain("Showing the first 25");
  });

  it("explains an empty result and how to widen it", async () => {
    const { service } = build(fakeRepository(), { extract: vi.fn().mockResolvedValue(terms(["washer"])) });
    const result = await service.query({ message: "tenders I quoted last month for washers" }, caller);
    expect(result.reply).toBe("No tenders found (Item: washer · Quoted: last month (August 2026)). Try removing a filter.");
    expect(result.state).not.toBeNull();
  });
});

describe("AssistantService — plain document search path", () => {
  beforeEach(() => {
    generateJsonMock.mockReset();
    generateTextMock.mockReset();
  });

  it("uses the LLM-extracted tender number to build the search query", async () => {
    generateJsonMock.mockResolvedValue({ tenderNumber: "TST-1783835577-Sam", documentType: "BILL", freeTextQuery: "bill" });
    generateTextMock.mockResolvedValue("Found it — here's the bill.");
    const searchResult: SearchResultsDto = {
      query: "TST-1783835577-Sam",
      results: [{ type: "Attachment", id: randomUUID(), title: "BILL-ABC.pdf", subtitle: "TST-1783835577-Sam", href: "/tenders/1?tab=documents" }],
    };
    const search = vi.fn().mockResolvedValue(searchResult);
    const repo = fakeRepository();
    const { service } = build(repo, { search });

    const result = await service.query({ message: "find me the bill for tender TST-1783835577-Sam" }, caller);

    expect(search).toHaveBeenCalledWith(businessId, expect.stringContaining("TST-1783835577-Sam"));
    expect(result.reply).toBe("Found it — here's the bill.");
    expect(result.results).toEqual(searchResult.results);
    expect(result.state).toBeNull();
    expect(repo.findBills).not.toHaveBeenCalled(); // a document number is a lookup, not a filter query
  });

  it("falls back to the raw message when Ollama can't parse intent", async () => {
    generateJsonMock.mockRejectedValue(new ServiceUnavailableError("Ollama not reachable"));
    generateTextMock.mockRejectedValue(new ServiceUnavailableError("Ollama not reachable"));
    const search = vi.fn().mockResolvedValue({ query: "undertaking for TND-9", results: [] });
    const { service } = build(fakeRepository(), { search });

    const result = await service.query({ message: "undertaking for TND-9" }, caller);

    expect(search).toHaveBeenCalledWith(businessId, "undertaking for TND-9");
    expect(result.reply).toBe("Nothing found matching that.");
  });

  it("replies with a deterministic message when nothing is found", async () => {
    generateJsonMock.mockResolvedValue({ tenderNumber: null, documentType: null, freeTextQuery: "xyz" });
    const { service } = build(fakeRepository());
    const result = await service.query({ message: "xyz" }, caller);
    expect(result.reply).toBe("Nothing found matching that.");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("falls back to document search when a bare phrase matches no items but is a real title", async () => {
    generateJsonMock.mockResolvedValue({ tenderNumber: null, documentType: null, freeTextQuery: "switchgear installation" });
    generateTextMock.mockResolvedValue("Found the tender.");
    const hit = { type: "Tender" as const, id: "t9", title: "Switchgear installation", subtitle: "TND-9", href: "/tenders/t9" };
    const search = vi.fn().mockResolvedValue({ query: "switchgear installation", results: [hit] });
    const { service } = build(fakeRepository(), {
      search,
      extract: vi.fn().mockResolvedValue(terms(["switchgear installation"])),
    });

    const result = await service.query({ message: "switchgear installation" }, caller);
    expect(result.results).toEqual([hit]);
    expect(result.state).toBeNull();
  });

  it("treats 'a kind + an unexplained identifier' as a lookup, not 'list every bill'", async () => {
    generateJsonMock.mockResolvedValue({ tenderNumber: "1400014205", documentType: "bill", freeTextQuery: "bill 1400014205" });
    generateTextMock.mockResolvedValue("Found it.");
    const hit = { type: "Tender" as const, id: "t5", title: "Some tender", subtitle: "1400014205", href: "/tenders/t5" };
    const search = vi.fn().mockResolvedValue({ query: "1400014205", results: [hit] });
    const repo = fakeRepository();
    const { service } = build(repo, { search });

    const result = await service.query({ message: "find the bill for tender 1400014205" }, caller);

    expect(repo.findBills).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledWith(businessId, "1400014205");
    expect(result.results).toEqual([hit]);
  });

  it("lists a kind when nothing but the kind is asked for", async () => {
    const repo = fakeRepository({ rfq: { total: 0, hits: [] } });
    const { service } = build(repo);
    const result = await service.query({ message: "show me RFQs" }, caller);
    expect(repo.findRfqs).toHaveBeenCalled();
    expect(result.state?.entity).toBe("rfq");
  });

  it("does not use the search path when a follow-up merely names nothing new", async () => {
    const { service, search } = build(fakeRepository());
    const prior: AssistantQueryState = {
      entity: "tender", itemTerms: ["washer"], statuses: [], dateField: "created", dateRange: null, partyText: null,
    };
    await service.query({ message: "the ones which I won", state: prior }, caller);
    expect(search).not.toHaveBeenCalled();
  });
});
