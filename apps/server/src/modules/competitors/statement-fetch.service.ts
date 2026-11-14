import { isSailRfxNumber, type FetchStatementResultDto, type TenderStatus } from "@bmp/types";

import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  UnprocessableEntityError,
} from "../../core/errors/HttpErrors.js";
import type { AuditService } from "../audit/audit.service.js";
import { PortalLoginRequiredError, StatementNotAvailableError } from "../portal-bid/portal/comparative-grid.js";

import { parseComparativeMatrix, StatementParseError } from "./comparative-statement.parser.js";
import type { ICompetitorsRepository } from "./competitors.repository.js";
import type { CompetitorsService } from "./competitors.service.js";

/** Where a statement grid comes from: the portal browser window in production. */
export interface StatementSource {
  read(rfxNumber: string): Promise<string[][]>;
}

/** The price bids have been opened: from Submitted on, a statement may exist on the portal. */
const FETCHABLE_STATUSES = new Set(["SUBMITTED", "PRICE_OPENED", "WON", "LOST"]);

export interface FetchContext {
  businessId: string;
  roleId: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * Reads a tender's comparative statement from the portal and saves it. All or nothing: a page
 * that cannot be read with confidence stores nothing, and the caller is told why. A tender that
 * was still Submitted moves on to Price opened; the result (Won/Lost) is never set here, because
 * the lowest quote is not always who gets the order.
 */
export class StatementFetchService {
  constructor(
    private readonly deps: {
      repository: ICompetitorsRepository;
      competitors: CompetitorsService;
      source: StatementSource;
      audit: AuditService;
      /** Moves the tender Submitted -> Price opened through the normal status-change path. */
      markPriceOpened: (tenderId: string, actorId: string, context: FetchContext) => Promise<unknown>;
    },
  ) {}

  async fetch(tenderId: string, actorId: string, context: FetchContext): Promise<FetchStatementResultDto> {
    const { businessId } = context;
    const tender = await this.deps.repository.findTender(businessId, tenderId);
    if (!tender) throw new NotFoundError("Tender not found");
    if (!FETCHABLE_STATUSES.has(tender.status)) {
      throw new BadRequestError("The comparative statement can be fetched once the tender has been submitted");
    }
    if (!isSailRfxNumber(tender.tenderNumber)) {
      throw new BadRequestError(
        `Tender number ${tender.tenderNumber} is not a SAIL ISP RFx number, so there is no comparative statement to fetch`,
      );
    }

    let grid: string[][];
    try {
      grid = await this.deps.source.read(tender.tenderNumber);
    } catch (error) {
      if (error instanceof PortalLoginRequiredError || error instanceof StatementNotAvailableError) {
        throw new ConflictError(`${error.message.replace(/\.$/, "")}. Nothing was saved.`);
      }
      const reason = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableError(`The portal browser could not be opened on the server: ${reason}`);
    }

    let statement;
    try {
      statement = parseComparativeMatrix(grid);
    } catch (error) {
      if (!(error instanceof StatementParseError)) throw error;
      throw new UnprocessableEntityError(
        `Could not read the comparative statement: ${error.message}. Nothing was saved.`,
      );
    }

    const stored = await this.deps.competitors.store(businessId, tenderId, statement, grid);
    await this.deps.audit.log({
      actorId,
      action: "COMPARATIVE_STATEMENT_FETCHED",
      entityType: "Tender",
      entityId: tenderId,
      entityCode: tender.tenderNumber,
      businessId,
      metadata: { bidders: stored.bidders, items: stored.items, lowestBidder: stored.lowestBidder },
    });

    let status = tender.status as TenderStatus;
    if (status === "SUBMITTED") {
      await this.deps.markPriceOpened(tenderId, actorId, context);
      status = "PRICE_OPENED";
    }
    return { ...stored, status };
  }
}
