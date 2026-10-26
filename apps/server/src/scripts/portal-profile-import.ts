/* eslint-disable no-console -- command-line tool: console is its output */
import { parseArgs } from "node:util";

import { prisma } from "../infra/prisma/client.js";
import { PortalSession } from "../modules/portal-bid/portal/portal-session.js";
import { portalProfileRepository } from "../modules/portal-bid/portal-bid.module.js";
import { SAIL_ISP_QUESTIONS } from "../modules/portal-bid/sail-isp.questions.js";

const { values } = parseArgs({
  options: { business: { type: "string" }, cdp: { type: "string", default: "http://127.0.0.1:9222" } },
});

/**
 * Copies the answers currently on the open portal response into this business's SAIL ISP profile,
 * so one hand-filled response seeds every later fill. Tender-derived answers (weight, HSN,
 * delivery period) are deliberately not imported: they belong to that one tender.
 */
async function main(): Promise<void> {
  if (!values.business) throw new Error("usage: portal:profile:import --business <business code> [--cdp <url>]");
  const business = await prisma.business.findUnique({ where: { code: values.business } });
  if (!business) throw new Error(`No business with code ${values.business}`);

  const session = await PortalSession.attach(values.cdp!);
  await session.openTab("Questions");
  const answers = await portalProfileRepository.findAnswers(business.id, "SAIL_ISP");
  let imported = 0;
  for (const spec of SAIL_ISP_QUESTIONS) {
    if (spec.source === "tender") continue;
    try {
      const value = await session.readField(spec.label);
      if (value) {
        answers[spec.key] = value;
        imported += 1;
      }
      if (spec.hasComment) {
        const comment = await session.readComment(spec.label);
        if (comment) answers[`${spec.key}.comment`] = comment;
      }
    } catch {
      console.warn(`not on the page: ${spec.label}`);
    }
  }
  await portalProfileRepository.saveAnswers(business.id, "SAIL_ISP", answers);
  console.log(`Imported ${imported} answers into ${business.code}'s SAIL ISP profile`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
