import { readFileSync } from "node:fs";
import path from "node:path";

import type { FetchStatementResultDto, TenderStandingDto } from "@bmp/types";
import { beforeEach, describe, expect, it } from "vitest";

import { BadRequestError, ConflictError, UnprocessableEntityError } from "../../../core/errors/HttpErrors.js";
import type { AuditService } from "../../audit/audit.service.js";
import { PortalLoginRequiredError } from "../../portal-bid/portal/comparative-grid.js";
import type { ICompetitorsRepository, TenderForStatement } from "../competitors.repository.js";
import type { CompetitorsService } from "../competitors.service.js";
import { StatementFetchService } from "../statement-fetch.service.js";

const matrix = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures", "comparative-1400000013.matrix.json"), "utf8"),
) as string[][];
const CONTEXT = { businessId: "biz-1", roleId: "role-1" };

const STANDING: TenderStandingDto = {
  fetchedAt: "2026-11-16T00:00:00.000Z",
  basisOfEvaluation: "Overall",
  bidders: 5,
  usIdentified: true,
  ourRank: 4,
  ourTotal: 891000,
  lowest: { competitorId: "c-2", name: "BETA ENGINEERING CORPORATION", total: 528000, isSelf: false },
};

function setup(
  status: string,
  grid: () => Promise<string[][]> = () => Promise.resolve(matrix),
  standing: TenderStandingDto | null = null,
) {
  const tender: TenderForStatement = {
    id: "tender-1",
    tenderNumber: "1400000013",
    status,
    businessName: "Acme",
    portalResponseNumber: null,
    boqItems: [],
  };
  const calls = { read: 0, stored: 0, advanced: [] as Record<string, unknown>[], audited: [] as string[] };
  const stored: Omit<FetchStatementResultDto, "status" | "ourRank"> = {
    tenderId: tender.id,
    bidders: 5,
    items: 1,
    lowestBidder: "BETA ENGINEERING CORPORATION",
    usFound: true,
  };
  const service = new StatementFetchService({
    repository: { findTender: () => Promise.resolve(tender) } as unknown as ICompetitorsRepository,
    competitors: {
      store: () => {
        calls.stored += 1;
        return Promise.resolve(stored);
      },
      standing: () => Promise.resolve(standing),
    } as unknown as CompetitorsService,
    source: {
      read: () => {
        calls.read += 1;
        return grid();
      },
    },
    audit: {
      log: (entry: { action: string }) => {
        calls.audited.push(entry.action);
        return Promise.resolve();
      },
    } as unknown as AuditService,
    changeStatus: (_tenderId, input) => {
      calls.advanced.push(input);
      return Promise.resolve();
    },
  });
  return { service, calls };
}

describe("StatementFetchService.fetch", () => {
  let run: ReturnType<typeof setup>;
  beforeEach(() => {
    run = setup("SUBMITTED");
  });

  it("moves a submitted tender to Price opened once its statement is saved", async () => {
    const result = await run.service.fetch("tender-1", "user-1", CONTEXT);
    expect(run.calls).toMatchObject({ read: 1, stored: 1, advanced: [{ status: "PRICE_OPENED" }] });
    expect(result).toMatchObject({ status: "PRICE_OPENED", bidders: 5 });
    expect(run.calls.audited).toEqual(["COMPARATIVE_STATEMENT_FETCHED"]);
  });

  it("marks the tender Lost to the lowest bidder when we are not the lowest", async () => {
    run = setup("SUBMITTED", undefined, STANDING);
    const result = await run.service.fetch("tender-1", "user-1", CONTEXT);
    expect(result).toMatchObject({ status: "LOST", ourRank: 4 });
    expect(run.calls.advanced).toMatchObject([
      { status: "PRICE_OPENED" },
      {
        status: "LOST",
        winnerName: "BETA ENGINEERING CORPORATION",
        winningBidAmount: 528000,
        lossReason: "L4 of 5 at price opening",
      },
    ]);
  });

  it.each([
    ["we are the lowest", { ...STANDING, ourRank: 1, lowest: { ...STANDING.lowest!, isSelf: true } }],
    ["our bid is not recognised", { ...STANDING, usIdentified: false, ourRank: null }],
    ["bids are evaluated item by item", { ...STANDING, basisOfEvaluation: "Item Wise" }],
    ["nobody quoted every item", { ...STANDING, lowest: null }],
  ])("leaves the result open when %s", async (_name, standing) => {
    run = setup("SUBMITTED", undefined, standing);
    const result = await run.service.fetch("tender-1", "user-1", CONTEXT);
    expect(result.status).toBe("PRICE_OPENED");
    expect(run.calls.advanced).toMatchObject([{ status: "PRICE_OPENED" }]);
  });

  it("does not mark a reopened tender Lost again on a re-read", async () => {
    run = setup("PRICE_OPENED", undefined, STANDING);
    expect((await run.service.fetch("tender-1", "user-1", CONTEXT)).status).toBe("PRICE_OPENED");
    expect(run.calls.advanced).toEqual([]);
  });

  it.each(["PRICE_OPENED", "WON", "LOST"])("re-reads a %s tender without changing its status", async (status) => {
    run = setup(status);
    const result = await run.service.fetch("tender-1", "user-1", CONTEXT);
    expect(run.calls).toMatchObject({ stored: 1, advanced: [] });
    expect(result.status).toBe(status);
  });

  it.each(["DRAFT", "CANCELLED"])("refuses a %s tender without touching the portal", async (status) => {
    run = setup(status);
    await expect(run.service.fetch("tender-1", "user-1", CONTEXT)).rejects.toThrow(BadRequestError);
    expect(run.calls).toMatchObject({ read: 0, stored: 0, advanced: [] });
  });

  it("leaves the tender Submitted when the portal needs a login", async () => {
    run = setup("SUBMITTED", () => Promise.reject(new PortalLoginRequiredError()));
    await expect(run.service.fetch("tender-1", "user-1", CONTEXT)).rejects.toThrow(ConflictError);
    expect(run.calls).toMatchObject({ stored: 0, advanced: [] });
  });

  it("leaves the tender Submitted when the page is not a statement", async () => {
    run = setup("SUBMITTED", () => Promise.resolve([["Menu"]]));
    await expect(run.service.fetch("tender-1", "user-1", CONTEXT)).rejects.toThrow(UnprocessableEntityError);
    expect(run.calls).toMatchObject({ stored: 0, advanced: [] });
  });
});
