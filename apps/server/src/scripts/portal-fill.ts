/* eslint-disable no-console -- command-line tool: console is its output */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { prisma } from "../infra/prisma/client.js";
import { auditService } from "../modules/audit/audit.module.js";
import { fillBid } from "../modules/portal-bid/portal/fill-bid.js";
import { PortalSession } from "../modules/portal-bid/portal/portal-session.js";
import { bidPayloadService, portalBidRepository } from "../modules/portal-bid/portal-bid.module.js";
import { tendersRepository } from "../modules/tenders/tenders.module.js";

const { values } = parseArgs({
  options: {
    tender: { type: "string" },
    business: { type: "string" },
    cdp: { type: "string", default: "http://127.0.0.1:9222" },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    "questions-only": { type: "boolean", default: false },
    save: { type: "boolean", default: false },
    only: { type: "string" },
    "items-only": { type: "boolean", default: false },
  },
});

async function main(): Promise<number> {
  if (!values.tender || !values.business) {
    console.error("usage: portal:fill --tender <tender number> --business <business code> [--dry-run] [--yes] [--questions-only] [--save] [--only key,key] [--items-only] [--cdp <url>]");
    return 2;
  }
  const business = await prisma.business.findUnique({ where: { code: values.business } });
  if (!business) throw new Error(`No business with code ${values.business}`);
  const tender = await tendersRepository.findByTenderNumber(values.tender, business.id);
  if (!tender) throw new Error(`No tender ${values.tender} in business ${business.code}`);

  const payload = await bidPayloadService.buildPayload(tender.id, business.id, "SAIL_ISP", {
    includeItems: !values["questions-only"],
  });
  if (values.only) {
    // Limit the run to some catalog keys, e.g. --only hsnCode,consignmentWeight.
    const wanted = new Set(values.only.split(",").map((key) => key.trim()));
    payload.answers = payload.answers.filter((answer) => wanted.has(answer.key));
  }
  console.log(`\nQuestions (${payload.answers.length}):`);
  for (const a of payload.answers) {
    console.log(`  [${a.source.padEnd(8)}] ${a.label.slice(0, 70)} = ${a.value}${a.comment ? `  (comment: ${a.comment})` : ""}`);
  }
  console.log(`\nItems (${payload.items.length}), expected total ${payload.expectedTotal}:`);
  for (const i of payload.items) {
    console.log(`  ${i.itemCode}  qty ${i.quantity} x ${i.rate}  CGST ${i.cgstPct}% SGST ${i.sgstPct}% IGST ${i.igstPct}%`);
  }
  if (payload.warnings.length > 0) console.log(`\nWarnings:\n${payload.warnings.map((w) => `  - ${w}`).join("\n")}`);

  const session = await PortalSession.attach(values.cdp!);
  const result = await fillBid(
    {
      session,
      payload,
      tenderNumber: values.tender,
      businessId: business.id,
      tenderId: tender.id,
      dryRun: values["dry-run"]!,
      questionsOnly: values["questions-only"]!,
      itemsOnly: values["items-only"]!,
      save: values.save!,
      confirm: async (_warnings, header) => {
        if (values.yes) return true;
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question(
          `\nType into portal response ${header.responseNumber} (RFx ${header.rfxNumber})? [y/N] `,
        );
        rl.close();
        return answer.trim().toLowerCase() === "y";
      },
    },
    { portalBids: portalBidRepository, audit: auditService },
  );

  console.log(`\nResponse ${result.responseNumber}: ${values["dry-run"] ? "dry run, nothing typed" : `${result.filled} fields filled`}`);
  for (const s of result.skipped) console.log(`  skipped: ${s}`);
  for (const m of result.mismatches) console.log(`  MISMATCH: ${m}`);
  if (!values["dry-run"]) {
    console.log(result.saved ? "Saved." : "Not saved.", "Submit it yourself once you have reviewed it.");
  }
  return result.skipped.length > 0 || result.mismatches.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
