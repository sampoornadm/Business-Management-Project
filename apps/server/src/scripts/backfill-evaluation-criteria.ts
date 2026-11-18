/* eslint-disable no-console -- command-line tool: console is its output */
import { parseArgs } from "node:util";

import { matchEvaluationCriteria } from "@bmp/types";

import { prisma } from "../infra/prisma/client.js";
import { s3Service } from "../infra/storage/s3.service.js";
import { parseEvaluationCriteria } from "../modules/tenders/tender-header.parser.js";
import { extractPdfText } from "../shared/utils/pdf-text.js";

const { values } = parseArgs({ options: { business: { type: "string" }, tender: { type: "string" } } });

/** Re-reads one tender's current NIT PDF and stores its Evaluation Criteria on the tender. */
async function main(): Promise<void> {
  if (!values.business || !values.tender) {
    throw new Error("usage: backfill-evaluation-criteria --business <business code> --tender <tender number>");
  }
  const business = await prisma.business.findUniqueOrThrow({ where: { code: values.business } });
  const tender = await prisma.tender.findFirstOrThrow({
    where: { businessId: business.id, tenderNumber: values.tender },
  });
  const nit = await prisma.attachment.findFirstOrThrow({
    where: { entityType: "Tender", entityId: tender.id, documentType: "NIT", isCurrent: true },
  });
  const text = await extractPdfText(await s3Service.getObject(nit.storagePath), { layout: true });
  const wording = parseEvaluationCriteria(text);
  if (!wording) throw new Error(`No "Evaluation Criteria" row found in ${nit.originalName}`);
  // Keyword match only (no AI in this script): set an unrecognised wording by hand on the edit form.
  const evaluationCriteria = matchEvaluationCriteria(wording);
  if (!evaluationCriteria) throw new Error(`"${wording}" is neither Overall nor Individual; set it on the tender's edit form.`);
  await prisma.tender.update({ where: { id: tender.id }, data: { evaluationCriteria } });
  console.log(`${tender.tenderNumber}: evaluationCriteria = ${evaluationCriteria}`);
}

main().then(() => prisma.$disconnect(), (error) => { console.error(error); process.exit(1); });
