import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildExamples, splitExamples, summarise, type TariffRow, type TrainingExample } from "./hsn-dataset.builder.js";
import { readLookupSheet } from "./hsn-gst-lookup.reader.js";
import { HsnTaxonomyImportService } from "./hsn-taxonomy-import.service.js";

/**
 * Regenerates the classifier's training corpus from the lookup sheet and the CBIC tariff text.
 *
 * Shared by scripts/build-hsn-dataset.ts and the Settings rebuild, because they must produce
 * byte-identical output — a model trained on what the script writes and then rebuilt from what the
 * worker writes would differ for no visible reason.
 *
 * Only train and validation are written here. The evaluation set is deliberately NOT regenerated:
 * it is the measurement, its labels are set by hand, and rebuilding it from the app's own data on
 * every retrain would quietly turn the score into a measure of agreement with itself.
 */

export interface DatasetStats {
  examples: number;
  headings: number;
  chapters: number;
  train: number;
  validation: number;
  conflicts: number;
}

export interface TariffSource {
  findTariffRows(): Promise<TariffRow[]>;
}

function toJsonl(examples: TrainingExample[]): string {
  return examples.map((example) => JSON.stringify(example)).join("\n") + "\n";
}

export async function buildDatasets(repoRoot: string, source: TariffSource): Promise<DatasetStats> {
  const sheet = await readLookupSheet(HsnTaxonomyImportService.resolveSheetPath(repoRoot));
  const tariff = await source.findTariffRows();

  const { examples, conflicts } = buildExamples(sheet, tariff);
  const { train, validation } = splitExamples(examples);
  const stats = summarise(examples);

  const generated = path.join(repoRoot, "ml/data/generated");
  await mkdir(generated, { recursive: true });
  await writeFile(path.join(generated, "train.jsonl"), toJsonl(train));
  await writeFile(path.join(generated, "validation.jsonl"), toJsonl(validation));
  await writeFile(
    path.join(generated, "stats.json"),
    JSON.stringify({ ...stats, train: train.length, validation: validation.length, conflicts }, null, 2) + "\n",
  );

  return {
    examples: stats.total,
    headings: stats.headings,
    chapters: stats.chapters,
    train: train.length,
    validation: validation.length,
    conflicts: conflicts.length,
  };
}
