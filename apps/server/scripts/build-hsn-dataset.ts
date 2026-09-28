#!/usr/bin/env tsx
/**
 * Builds the classifier's training corpus from the lookup sheet and the CBIC tariff text, and
 * assembles a held-out evaluation set from the app's own items.
 *
 *   pnpm --filter @bmp/server exec tsx scripts/build-hsn-dataset.ts
 *
 * Writes (all git-tracked, so a dataset change shows up in review):
 *   ml/data/generated/train.jsonl
 *   ml/data/generated/validation.jsonl
 *   ml/data/generated/stats.json
 *   ml/data/eval/real-items.csv   — real BOQ lines, for the only accuracy number that counts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "../src/infra/prisma/client.js";
import { buildDatasets } from "../src/modules/reference-data/hsn-dataset.writer.js";
import { ReferenceDataRepository } from "../src/modules/reference-data/reference-data.repository.js";

import { EVAL_LABELS } from "./hsn-gst-seed-data.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const EVAL_DIR = path.join(REPO_ROOT, "ml/data/eval");

// Hand-wired, like import-hsn-sac.ts: importing reference-data.module.ts would pull in the
// Redis-backed queues and the script would never exit.
const referenceDataRepository = new ReferenceDataRepository(prisma);

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * The evaluation set: real BOQ lines, with the label they SHOULD get.
 *
 * Deliberately not built from the app's confirmed codes. Of the 19 a human had confirmed, 11 were
 * wrong — nylon cable ties carrying 8534 (printed circuits) and 8537 (control panels), a fibreglass
 * sleeve carrying 3926, the same PVC tape carrying four different codes. They are old bad
 * suggestions that were clicked through, so scoring against them would measure agreement with the
 * bug being replaced. `app_confirmed` is carried alongside purely so the damage stays visible.
 *
 * `expected_heading` is seeded from EVAL_LABELS where a call can be defended, and left blank
 * otherwise. Filling in the blanks by hand is what grows the only honest measurement here.
 */
async function buildEvalSet(): Promise<{
  rows: string[];
  seeded: number;
  appDisagrees: number;
  total: number;
}> {
  const items = await prisma.boqItem.findMany({
    where: { description: { not: "" } },
    select: {
      description: true,
      hsnCode: true,
      hsnCodeConfirmed: true,
      suggestedHsnCode: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const seen = new Set<string>();
  const rows = ["description,expected_heading,label_basis,app_confirmed,current_suggestion"];
  let seeded = 0;
  let appDisagrees = 0;

  for (const item of items) {
    const description = item.description.replace(/\s+/g, " ").trim();
    if (!description || seen.has(description.toLowerCase())) continue;
    seen.add(description.toLowerCase());

    const rule = EVAL_LABELS.find((candidate) => candidate.pattern.test(description));
    const expected = rule?.heading ?? "";
    if (expected) seeded += 1;

    const appConfirmed = item.hsnCodeConfirmed && item.hsnCode ? item.hsnCode.slice(0, 4) : "";
    if (expected && appConfirmed && expected !== appConfirmed) appDisagrees += 1;

    rows.push(
      [
        csvCell(description),
        expected,
        csvCell(rule?.why ?? ""),
        appConfirmed,
        item.suggestedHsnCode?.slice(0, 4) ?? "",
      ].join(","),
    );
  }

  return { rows, seeded, appDisagrees, total: rows.length - 1 };
}

async function main() {
  // The corpus itself is written by the same code the Settings rebuild runs, so the two cannot
  // drift. This script adds the evaluation set, which the rebuild deliberately never regenerates.
  const stats = await buildDatasets(REPO_ROOT, referenceDataRepository);

  const evalSet = await buildEvalSet();
  await mkdir(EVAL_DIR, { recursive: true });
  await writeFile(path.join(EVAL_DIR, "real-items.csv"), evalSet.rows.join("\n") + "\n");

  console.warn(
    [
      `corpus:      ${stats.examples} examples across ${stats.headings} headings, ${stats.chapters} chapters`,
      `split:       ${stats.train} train / ${stats.validation} validation`,
      `eval set:    ${evalSet.total} distinct real items, ${evalSet.seeded} with a seeded expected label`,
      `             ${evalSet.appDisagrees} of those contradict the code confirmed in the app`,
      stats.conflicts > 0 ? `conflicts:   ${stats.conflicts} (see stats.json)` : "conflicts:   none",
    ].join("\n"),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
