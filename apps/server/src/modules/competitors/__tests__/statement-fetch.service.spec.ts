import { readFileSync } from "node:fs";
import path from "node:path";

import type { FetchStatementResultDto } from "@bmp/types";
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

function setup(status: string, grid: () => Promise<string[][]> = () => Promise.resolve(matrix)) {
  const tender: TenderForStatement = {
    id: "tender-1",
    tenderNumber: "1400000013",
    status,
    businessName: "Acme",
    portalResponseNumber: null,
    boqItems: [],
  };
  const calls = { read: 0, stored: 0, advanced: [] as string[], audited: [] as string[] };
  const stored: Omit<FetchStatementResultDto, "status"> = {
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
    markPriceOpened: (tenderId) => {
      calls.advanced.push(tenderId);
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
    expect(run.calls).toMatchObject({ read: 1, stored: 1, advanced: ["tender-1"] });
    expect(result).toMatchObject({ status: "PRICE_OPENED", bidders: 5 });
    expect(run.calls.audited).toEqual(["COMPARATIVE_STATEMENT_FETCHED"]);
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
