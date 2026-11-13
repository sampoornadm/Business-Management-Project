import type { FetchStatementResultDto } from "@bmp/types";

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

/** A result is only published once the client has opened the tender. */
const RESULT_STATUSES = new Set(["WON", "LOST"]);

/**
 * Reads a tender's comparative statement from the portal and saves it. All or nothing: a page
 * that cannot be read with confidence stores nothing, and the caller is told why.
 */
export class StatementFetchService {
  constructor(
    private readonly deps: {
      repository: ICompetitorsRepository;
      competitors: CompetitorsService;
      source: StatementSource;
      audit: AuditService;
    },
  ) {}

  async fetch(businessId: string, tenderId: string, actorId: string): Promise<FetchStatementResultDto> {
    const tender = await this.deps.repository.findTender(businessId, tenderId);
    if (!tender) throw new NotFoundError("Tender not found");
    if (!RESULT_STATUSES.has(tender.status)) {
      throw new BadRequestError("The comparative statement can be fetched once the tender is marked Won or Lost");
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

    const result = await this.deps.competitors.store(businessId, tenderId, statement, grid);
    await this.deps.audit.log({
      actorId,
      action: "COMPARATIVE_STATEMENT_FETCHED",
      entityType: "Tender",
      entityId: tenderId,
      entityCode: tender.tenderNumber,
      businessId,
      metadata: { bidders: result.bidders, items: result.items, lowestBidder: result.lowestBidder },
    });
    return result;
  }
}
