import type { AuditService } from "../../audit/audit.service.js";
import type { IPortalBidRepository } from "../portal-bid.repository.js";
import type { BidPayload, Widget } from "../portal-bid.types.js";

import type { ConditionRow, PortalHeader, PortalTab } from "./portal-session.js";

/** What `fillBid` needs from the page driver, so tests can stand in an in-memory portal. */
export interface IPortalSession {
  readHeader(): Promise<PortalHeader>;
  openTab(name: PortalTab): Promise<void>;
  readField(label: string): Promise<string>;
  readComment(label: string): Promise<string>;
  writeField(label: string, value: string, widget: Widget, options?: { comment?: string }): Promise<void>;
  readConditionRows(): Promise<ConditionRow[]>;
  writeCondition(itemCode: string, conditionType: string, amount: string): Promise<void>;
}

export interface FillBidInput {
  session: IPortalSession;
  payload: BidPayload;
  tenderNumber: string;
  businessId: string;
  tenderId: string;
  dryRun: boolean;
  /** Called once with the payload's warnings before anything is typed; false aborts the run. */
  confirm: (warnings: string[]) => Promise<boolean>;
}

export interface FillBidResult {
  filled: number;
  skipped: string[];
  mismatches: string[];
  responseNumber: string;
}

interface FillBidDeps {
  portalBids: IPortalBidRepository;
  audit: Pick<AuditService, "log">;
}

const PORTAL_CODE = "SAIL_ISP";
const PRICE = "Price";
const CGST = "CGST (Ded-ITC) %";
const SGST = "SGST (Ded-ITC) %";
const IGST = "IGST (Ded-ITC) %";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** "14,200.00 INR" -> 14200. */
export function parsePortalAmount(text: string | null): number | null {
  if (!text) return null;
  const parsed = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

/** "27.10.2026 15:00:00 INDIA" (IST) -> Date. */
export function parsePortalDeadline(text: string | null): Date | null {
  const match = /(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})/.exec(text ?? "");
  if (!match) return null;
  const [, day, month, year, hour, minute, second] = match.map(Number);
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  return new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second!) - IST_OFFSET_MS);
}

export async function fillBid(input: FillBidInput, deps: FillBidDeps): Promise<FillBidResult> {
  const { session, payload, dryRun } = input;
  const skipped: string[] = [];
  const mismatches: string[] = [];
  let filled = 0;

  const header = await session.readHeader();
  if (header.rfxNumber !== input.tenderNumber) {
    throw new Error(`This portal response is for RFx ${header.rfxNumber}, not ${input.tenderNumber}`);
  }
  if (dryRun) return { filled, skipped, mismatches, responseNumber: header.responseNumber };
  if (!(await input.confirm(payload.warnings))) throw new Error("Aborted by user");

  // Questions
  await session.openTab("Questions");
  const written = [];
  for (const answer of payload.answers) {
    try {
      await session.writeField(answer.label, answer.value, answer.widget, {
        ...(answer.comment !== undefined ? { comment: answer.comment } : {}),
      });
      written.push(answer);
      filled += 1;
    } catch (error) {
      const message = messageOf(error);
      if (message.startsWith("label not found")) skipped.push(answer.label);
      else mismatches.push(`${answer.label}: ${message}`);
    }
  }
  for (const answer of written) {
    const got = await session.readField(answer.label);
    if (got !== answer.value) mismatches.push(`${answer.label}: expected "${answer.value}", portal shows "${got}"`);
    if (answer.comment !== undefined) {
      const comment = await session.readComment(answer.label);
      if (comment !== answer.comment) {
        mismatches.push(`${answer.label} (comment): expected "${answer.comment}", portal shows "${comment}"`);
      }
    }
  }

  // Items / Conditions
  await session.openTab("Conditions");
  const portalCodes = new Set((await session.readConditionRows()).map((row) => row.itemCode));
  const bidCodes = new Set(payload.items.map((item) => item.itemCode));
  for (const code of portalCodes) if (!bidCodes.has(code)) skipped.push(`portal item ${code} has no BOQ item`);
  const pricedItems = payload.items.filter((item) => {
    if (portalCodes.has(item.itemCode)) return true;
    skipped.push(`item ${item.itemCode} is not on the portal`);
    return false;
  });
  for (const item of pricedItems) {
    const amounts: Array<[string, number]> = [
      [PRICE, item.rate],
      [CGST, item.cgstPct],
      [SGST, item.sgstPct],
      [IGST, item.igstPct],
    ];
    for (const [type, amount] of amounts) {
      await session.writeCondition(item.itemCode, type, String(amount));
      filled += 1;
    }
  }
  const after = new Map((await session.readConditionRows()).map((row) => [row.itemCode, row.conditions]));
  for (const item of pricedItems) {
    const shown = after.get(item.itemCode) ?? {};
    for (const [type, amount] of [[PRICE, item.rate], [CGST, item.cgstPct], [SGST, item.sgstPct], [IGST, item.igstPct]] as const) {
      if (Number(shown[type]) !== amount) {
        mismatches.push(`Item ${item.itemCode} ${type}: expected ${amount}, portal shows "${shown[type] ?? ""}"`);
      }
    }
  }

  const finalHeader = await session.readHeader();
  const portalTotal = parsePortalAmount(finalHeader.totalValue);
  if (portalTotal !== payload.expectedTotal) {
    mismatches.push(
      `Total Value: expected ${payload.expectedTotal}, portal shows ${finalHeader.totalValue ?? "nothing"} (press Calculate Value on the Items tab if it has not refreshed)`,
    );
  }

  const summary = { filled, skipped, mismatches, warnings: payload.warnings };
  await deps.portalBids.upsertFromFill({
    businessId: input.businessId,
    tenderId: input.tenderId,
    portalCode: PORTAL_CODE,
    responseNumber: header.responseNumber,
    submissionDeadline: parsePortalDeadline(header.deadline),
    totalValue: portalTotal,
    summary,
  });
  await deps.audit.log({
    actorId: null,
    action: "TENDER_PORTAL_FILL_COMPLETED",
    entityType: "Tender",
    entityId: input.tenderId,
    metadata: { responseNumber: header.responseNumber, source: "cli", ...summary },
  });

  return { filled, skipped, mismatches, responseNumber: header.responseNumber };
}
