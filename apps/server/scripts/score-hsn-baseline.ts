#!/usr/bin/env tsx
/**
 * Scores the CURRENT HSN matcher against the real evaluation set, and writes a run report.
 *
 *   pnpm --filter @bmp/server exec tsx scripts/score-hsn-baseline.ts
 *
 * This is the number any trained model has to beat. Without it, "the classifier is better" is an
 * assertion rather than a measurement.
 *
 * It runs the real path — keyword rule first, then ANN retrieval over the CBIC embeddings, then the
 * closed-vocabulary LLM pick — so the score reflects what the app actually does today, not an
 * approximation of it.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { env } from "../src/config/env.js";
import { embed, generateJson } from "../src/infra/llm/ollama.client.js";
import { prisma } from "../src/infra/prisma/client.js";
import { matchHsnByKeyword } from "../src/modules/reference-data/hsn-keyword-rules.js";
import { buildHsnMatchPrompt, parseHsnMatch } from "../src/modules/reference-data/hsn-matcher.js";
import { ReferenceDataRepository } from "../src/modules/reference-data/reference-data.repository.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const EVAL_PATH = path.join(REPO_ROOT, "ml/data/eval/real-items.csv");
const HSN_CODE_LENGTH = 4;
const HSN_CANDIDATE_LIMIT = 8;

const repository = new ReferenceDataRepository(prisma);

interface EvalRow {
  description: string;
  expected: string;
}

/** Minimal CSV reader — the file is written by build-hsn-dataset.ts, so the dialect is known. */
function parseCsv(text: string): EvalRow[] {
  const rows: EvalRow[] = [];
  const lines = text.split("\n").slice(1);

  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i]!;
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        cells.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current);

    const description = cells[0]?.trim() ?? "";
    const expected = cells[1]?.trim() ?? "";
    if (description && expected) rows.push({ description, expected });
  }

  return rows;
}

type Path = "keyword" | "ann+llm" | "abstained" | "error";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function classifyOnce(description: string): Promise<{ code: string | null; path: Path }> {
  const [vector] = await embed([description]);
  if (!vector) return { code: null, path: "abstained" };

  const candidates = await repository.findNearestHsn(vector, HSN_CODE_LENGTH, HSN_CANDIDATE_LIMIT);
  if (candidates.length === 0) return { code: null, path: "abstained" };

  const raw = await generateJson(
    buildHsnMatchPrompt(description, null, candidates),
    env.OLLAMA_ENRICHMENT_MODEL,
  );
  const code = parseHsnMatch(raw, new Set(candidates.map((c) => c.code)));
  return { code, path: code ? "ann+llm" : "abstained" };
}

/**
 * A local Ollama under load drops the occasional request — a 500 mid-run already cost one full
 * pass. One retry absorbs the blip, and a second failure is recorded as `error` rather than as a
 * wrong answer, so an infrastructure hiccup neither aborts the run nor deflates the baseline the
 * trained model has to beat.
 */
async function classify(description: string): Promise<{ code: string | null; path: Path }> {
  const keyword = matchHsnByKeyword(description);
  if (keyword) return { code: keyword.code, path: "keyword" };

  try {
    return await classifyOnce(description);
  } catch {
    await sleep(2000);
  }

  try {
    return await classifyOnce(description);
  } catch (err) {
    console.warn(`  ! ${(err as Error).message} — ${description.slice(0, 50)}`);
    return { code: null, path: "error" };
  }
}

async function main() {
  const rows = parseCsv(await readFile(EVAL_PATH, "utf8"));
  if (rows.length === 0) throw new Error("Evaluation set has no labelled rows.");

  console.warn(`Scoring ${rows.length} labelled items against the current matcher...`);

  const results: (EvalRow & { got: string | null; path: Path; correct: boolean })[] = [];
  const byPath: Record<Path, { n: number; correct: number }> = {
    keyword: { n: 0, correct: 0 },
    "ann+llm": { n: 0, correct: 0 },
    abstained: { n: 0, correct: 0 },
    error: { n: 0, correct: 0 },
  };

  for (const [index, row] of rows.entries()) {
    const { code, path: taken } = await classify(row.description);
    const correct = code === row.expected;
    results.push({ ...row, got: code, path: taken, correct });

    byPath[taken].n += 1;
    if (correct) byPath[taken].correct += 1;

    if ((index + 1) % 10 === 0) console.warn(`  ${index + 1}/${rows.length}`);
  }

  // An Ollama outage is not the matcher getting an answer wrong. Errored items leave the
  // denominator entirely — counting them as misses would understate the bar a trained model has to
  // clear, which is the flattering direction and therefore the wrong one.
  const errored = results.filter((r) => r.path === "error");
  const scored = results.filter((r) => r.path !== "error");
  const answered = scored.filter((r) => r.got !== null);
  const correct = scored.filter((r) => r.correct);
  const accuracy = scored.length > 0 ? correct.length / scored.length : 0;
  const precision = answered.length > 0 ? correct.length / answered.length : 0;

  const runDir = path.join(REPO_ROOT, "ml/runs", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(runDir, { recursive: true });

  const misses = scored
    .filter((r) => !r.correct)
    .map((r) => `| ${r.expected} | ${r.got ?? "(abstained)"} | ${r.path} | ${r.description.slice(0, 80)} |`);

  const report = [
    "# Baseline — current HSN matcher",
    "",
    `Run: ${new Date().toISOString()}`,
    `Model: ${env.OLLAMA_ENRICHMENT_MODEL} (ANN over bge-m3 embeddings of CBIC 4-digit headings)`,
    "",
    "This is the number a trained classifier has to beat.",
    "",
    "## Result",
    "",
    `- Items scored: **${scored.length}** of ${results.length} labelled`,
    `- Correct: **${correct.length}** (accuracy **${(accuracy * 100).toFixed(1)}%**)`,
    `- Answered: ${answered.length}, abstained: ${scored.length - answered.length}`,
    `- Precision when it answers: **${(precision * 100).toFixed(1)}%**`,
    ...(errored.length > 0
      ? [
          `- Excluded: ${errored.length} item(s) whose Ollama call failed twice — an outage, not a`,
          "  wrong answer, so they are out of the denominator rather than counted as misses.",
        ]
      : []),
    "",
    "## By path",
    "",
    "| path | n | correct | accuracy |",
    "| --- | --- | --- | --- |",
    ...(Object.entries(byPath) as [Path, { n: number; correct: number }][]).map(
      ([name, s]) =>
        `| ${name} | ${s.n} | ${s.correct} | ${s.n ? ((s.correct / s.n) * 100).toFixed(1) : "0.0"}% |`,
    ),
    "",
    "The keyword path is the hand-written deterministic rules; ann+llm is embedding retrieval",
    "followed by a closed-vocabulary pick. A high keyword score with a low ann+llm score means the",
    "system works only where somebody already wrote a rule for it.",
    "",
    "## Misses",
    "",
    "| expected | got | path | description |",
    "| --- | --- | --- | --- |",
    ...misses,
    "",
  ].join("\n");

  await writeFile(path.join(runDir, "report.md"), report);
  await writeFile(
    path.join(runDir, "results.json"),
    JSON.stringify({ accuracy, precision, byPath, results }, null, 2) + "\n",
  );

  console.warn(
    [
      "",
      `accuracy:  ${correct.length}/${scored.length} = ${(accuracy * 100).toFixed(1)}%`,
      `precision: ${(precision * 100).toFixed(1)}% (abstained on ${scored.length - answered.length})`,
      ...(errored.length > 0 ? [`errors:    ${errored.length} excluded (Ollama failed twice)`] : []),
      `  keyword: ${byPath.keyword.correct}/${byPath.keyword.n}`,
      `  ann+llm: ${byPath["ann+llm"].correct}/${byPath["ann+llm"].n}`,
      `report:    ${path.relative(REPO_ROOT, runDir)}/report.md`,
    ].join("\n"),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
