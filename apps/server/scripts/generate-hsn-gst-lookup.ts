#!/usr/bin/env tsx
/**
 * Generates ml/data/hsn-gst-lookup.xlsx from the CBIC HSN/SAC reference data already in Postgres.
 *
 * Run once to create the sheet. After that the sheet is the source of truth — it is what the
 * Settings "Update" button reads, and it carries the user's own edits (rates, display names, trade
 * terms). Re-running REGENERATES it, so it takes an existing sheet into account: official
 * descriptions are refreshed from the database, but every user-editable column is preserved.
 *
 *   pnpm --filter @bmp/server exec tsx scripts/generate-hsn-gst-lookup.ts [outputPath]
 *
 * Pass --regenerate-labels to discard stored display names and re-derive them. Needed when
 * deriveDisplayName itself changes, because the sheet cannot tell a name the generator wrote from
 * one the user typed — everything else the user owns is preserved either way.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";

import { prisma } from "../src/infra/prisma/client.js";
import {
  deriveDisplayName,
  disambiguateDisplayNames,
  findOrphanHeadings,
  LOOKUP_SHEET_NAME,
  parseActiveFlag,
  parseGstRate,
  USER_EDITABLE_COLUMNS,
} from "../src/modules/reference-data/hsn-gst-lookup.js";

import {
  CHAPTER_RATES,
  HEADING_RATES,
  INACTIVE_CODES,
  RATE_EFFECTIVE_FROM,
  TRADE_TERMS,
} from "./hsn-gst-seed-data.js";

const SHEET_NAME = LOOKUP_SHEET_NAME;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_OUTPUT = path.join(REPO_ROOT, "ml/data/hsn-gst-lookup.xlsx");

/** Columns the user owns. On regeneration these are read back from the existing sheet and kept. */
const USER_EDITABLE = USER_EDITABLE_COLUMNS;

interface LookupRow {
  code: string;
  level: "chapter" | "heading";
  parent_code: string;
  official_description: string;
  display_name: string;
  gst_rate: number;
  rate_source: string;
  effective_from: string;
  active: boolean;
  trade_terms: string;
}

function rateFor(code: string, level: "chapter" | "heading"): { rate: number; source: string } {
  const override = HEADING_RATES[code];
  if (override !== undefined) return { rate: override, source: "notification-9/2025" };

  const chapter = level === "chapter" ? code : code.slice(0, 2);
  const chapterRate = CHAPTER_RATES[chapter];
  if (chapterRate !== undefined) return { rate: chapterRate, source: "chapter-default" };

  return { rate: 18, source: "chapter-default" };
}

/** Reads back the user-editable columns from an existing sheet so regeneration never loses edits. */
async function readExistingEdits(filePath: string): Promise<Map<string, Partial<LookupRow>>> {
  const edits = new Map<string, Partial<LookupRow>>();
  if (!existsSync(filePath)) return edits;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) return edits;

  const header: string[] = [];
  sheet.getRow(1).eachCell((cell, col) => {
    header[col] = String(cell.value ?? "").trim();
  });

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const byName: Record<string, unknown> = {};
    row.eachCell((cell, col) => {
      const name = header[col];
      if (name) byName[name] = cell.value;
    });
    const code = String(byName.code ?? "").trim();
    if (!code) return;

    const kept: Partial<LookupRow> = {};
    for (const field of USER_EDITABLE) {
      const value = byName[field];
      if (value === undefined || value === null || value === "") continue;
      if (field === "gst_rate") {
        const rate = parseGstRate(value);
        if (rate !== null) kept.gst_rate = rate;
      } else if (field === "active") {
        kept.active = parseActiveFlag(value);
      } else {
        kept[field] = String(value).trim() as never;
      }
    }
    edits.set(code, kept);
  });

  return edits;
}

async function buildRows(existing: Map<string, Partial<LookupRow>>): Promise<LookupRow[]> {
  const [hsn, sac, hsnDeep, sacDeep] = await Promise.all([
    prisma.hsnCode.findMany({
      where: { codeLength: { in: [2, 4] } },
      select: { code: true, description: true, codeLength: true },
    }),
    prisma.sacCode.findMany({
      where: { codeLength: { in: [2, 4] } },
      select: { code: true, description: true, codeLength: true },
    }),
    prisma.hsnCode.findMany({ where: { codeLength: { gt: 4 } }, select: { code: true, codeLength: true } }),
    prisma.sacCode.findMany({ where: { codeLength: { gt: 4 } }, select: { code: true, codeLength: true } }),
  ]);

  // Per table: an HSN heading is only real if an HSN subheading sits under it, and the two
  // numbering spaces must not vouch for each other. Pooled, every SAC heading would look orphaned.
  const orphans = new Set([
    ...findOrphanHeadings([...hsn, ...hsnDeep]),
    ...findOrphanHeadings([...sac, ...sacDeep]),
  ]);

  const all = [...hsn, ...sac].sort((a, b) => a.code.localeCompare(b.code));

  // Resolve labels across the whole set first: 15 heading descriptions repeat inside a chapter, so a
  // label alone cannot identify a row and a picker would otherwise show two identical entries.
  const names = disambiguateDisplayNames(
    all.map((record) => ({
      code: record.code,
      displayName: existing.get(record.code)?.display_name ?? deriveDisplayName(record.description),
    })),
  );

  return all.map((record) => {
    const level: "chapter" | "heading" = record.codeLength === 2 ? "chapter" : "heading";
    const edit = existing.get(record.code);
    const seeded = rateFor(record.code, level);

    return {
      code: record.code,
      level,
      parent_code: level === "heading" ? record.code.slice(0, 2) : "",
      official_description: record.description.replace(/\s+/g, " ").trim(),
      display_name: names.get(record.code) ?? record.code,
      gst_rate: edit?.gst_rate ?? seeded.rate,
      rate_source: edit?.rate_source ?? seeded.source,
      effective_from: RATE_EFFECTIVE_FROM,
      // INACTIVE_CODES and orphans win over a stored value: these are unusable in the nomenclature
      // itself (chapter 77 is reserved; an orphan heading is a row that was never a heading), not a
      // preference the user gets to override.
      active:
        INACTIVE_CODES.has(record.code) || orphans.has(record.code) ? false : (edit?.active ?? true),
      trade_terms: edit?.trade_terms ?? (TRADE_TERMS[record.code]?.join("; ") ?? ""),
    };
  });
}

async function writeSheet(rows: LookupRow[], outputPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BMP";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "code", key: "code", width: 10 },
    { header: "level", key: "level", width: 10 },
    { header: "parent_code", key: "parent_code", width: 12 },
    { header: "display_name", key: "display_name", width: 46 },
    { header: "gst_rate", key: "gst_rate", width: 10 },
    { header: "rate_source", key: "rate_source", width: 20 },
    { header: "effective_from", key: "effective_from", width: 14 },
    { header: "active", key: "active", width: 8 },
    { header: "trade_terms", key: "trade_terms", width: 80 },
    { header: "official_description", key: "official_description", width: 90 },
  ];

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle" };
  for (const row of rows) sheet.addRow(row);
  sheet.autoFilter = { from: "A1", to: { row: 1, column: sheet.columns.length } };

  const readme = workbook.addWorksheet("README");
  readme.columns = [{ width: 110 }];
  for (const line of [
    "HSN / GST LOOKUP — the source of truth for item categories, HSN codes and GST rates.",
    "",
    "Edit this file, then press Update on the Settings page. That rebuilds the category tree and the",
    "GST rates, regenerates the training data, retrains the classifier and re-categorises items.",
    "",
    "COLUMNS YOU OWN (your edits survive regeneration):",
    "  display_name  — the label shown in category pickers.",
    "  gst_rate      — GST percent for this code.",
    "  rate_source   — where the rate came from. Set to 'manual' when you correct one.",
    "  active        — FALSE hides a chapter/heading you never buy from, without losing coverage.",
    "                  Some rows arrive FALSE already: chapter 77 is reserved and unused, and 78",
    "                  rows in CBIC's file look like headings but have no subheadings beneath them",
    "                  (mostly subheading text that lost a leading zero and landed in the wrong",
    "                  chapter — '3073' reads 'Mussels' but sits in chapter 30, pharmaceuticals).",
    "                  Setting one back to TRUE will not stick; they are filtered on every rebuild.",
    "  trade_terms   — semicolon-separated real-world names for this code. THIS IS THE IMPORTANT ONE.",
    "",
    "WHY trade_terms MATTERS:",
    "  CBIC's official text does not contain the words people actually use. Heading 7320 lists",
    "  'LEAF-SPRINGS', 'HELICAL SPRINGS', 'COIL SPRING' and 'SPRING PINS' — it never says",
    "  'disc spring' or 'Belleville washer'. So when a purchase line says DISC SPRING WASHER, nothing",
    "  in the official text matches it. Adding that phrase here is what teaches the classifier.",
    "  If an item is being classified wrongly, add its real name to the correct row and press Update.",
    "",
    "ABOUT THE SEEDED RATES:",
    "  Rates were seeded from Notification 9/2025-CT(Rate), effective 22 September 2025, which merged",
    "  the 12% slab into 18% and replaced 28% with 40% for sin/luxury goods. CBIC publishes no",
    "  machine-readable HSN-to-rate file and the notification lists entries at mixed granularity, so",
    "  rows marked 'chapter-default' are an assumption from the chapter, not a verified per-code rate.",
    "  Check the codes you actually trade in and mark them 'manual' once confirmed.",
  ]) {
    readme.addRow([line]);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await workbook.xlsx.writeFile(outputPath);
}

async function main() {
  const args = process.argv.slice(2);
  const regenerateLabels = args.includes("--regenerate-labels");
  const pathArg = args.find((a) => !a.startsWith("--"));
  const outputPath = pathArg ? path.resolve(pathArg) : DEFAULT_OUTPUT;

  const existing = await readExistingEdits(outputPath);
  if (regenerateLabels) {
    for (const edit of existing.values()) delete edit.display_name;
  }
  if (existing.size > 0) {
    console.warn(
      `Found existing sheet — preserving user edits for ${existing.size} rows` +
        `${regenerateLabels ? " (display names re-derived)" : ""}.`,
    );
  }

  const rows = await buildRows(existing);
  await writeSheet(rows, outputPath);

  const chapters = rows.filter((r) => r.level === "chapter").length;
  const headings = rows.filter((r) => r.level === "heading").length;
  const withTerms = rows.filter((r) => r.trade_terms).length;
  const inactive = rows.filter((r) => !r.active).length;
  console.warn(
    `Wrote ${outputPath}\n  ${chapters} chapters, ${headings} headings, ${withTerms} rows with trade terms.` +
      `\n  ${inactive} rows marked inactive (reserved chapters + headings with no subheadings under them).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
