import { logger } from "../../shared/logger/logger.js";

import { summariseTrainerError } from "./classification.errors.js";

/**
 * Rebuilds the classifier from the lookup sheet: taxonomy, datasets, training, deploy, re-classify.
 *
 * This is what the Settings "Update" button starts. It runs on a queue rather than inside the
 * request because a fine-tune takes minutes, and it writes its progress to a ClassificationRun row
 * because this codebase has no job-progress mechanism — a row per run, polled by a status endpoint,
 * is the established precedent (see ReferenceDataImport).
 *
 * The rule that matters: a rebuild will not deploy a model worse than the one already running. A
 * sheet edit can make things worse, and the point of measuring is to refuse that automatically
 * rather than discover it later in someone's tender.
 */

/** In pipeline order. Recorded per step so a stalled run says where, not just that it stalled. */
export const REBUILD_STAGES = [
  "taxonomy",
  "datasets",
  "training",
  "index",
  "export",
  "deploy",
  "reclassify",
  "done",
] as const;

export type RebuildStage = (typeof REBUILD_STAGES)[number];
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";

export interface ClassificationRunRecord {
  evalAccuracy: number | null;
}

export interface IClassificationRunRepository {
  create(data: { triggeredById: string | null }): Promise<{ id: string }>;
  update(id: string, data: Record<string, unknown>): Promise<void>;
  findLatest(): Promise<unknown>;
  findLastDeployed(): Promise<ClassificationRunRecord | null>;
}

/** Shells out to the Python trainer — same pattern as pdftotext in shared/utils/pdf-text.ts. */
export interface PythonRunner {
  run(
    script: string,
    args?: string[],
    /** Called as the trainer prints, so a multi-minute step can show where it has got to. */
    onProgress?: (label: string) => void,
  ): Promise<{ stdout: string }>;
}

export interface RebuildDeps {
  runRepository: IClassificationRunRepository;
  python: PythonRunner;
  importTaxonomy: () => Promise<{ chapters: number; headings: number }>;
  buildDatasets: () => Promise<{ examples: number; headings: number }>;
  reloadModel: () => Promise<void>;
  reclassify: () => Promise<{ items: number; boqItems: number }>;
}

/**
 * Pulls the headline numbers out of train.py's own output.
 *
 * Parsing stdout rather than a JSON side-channel keeps one source of truth: what the trainer prints
 * is what the report contains and what the card shows. The format is pinned by the tests on both
 * sides, so a change to the trainer's wording breaks loudly instead of silently reporting nothing.
 */
export function parseTrainingOutput(stdout: string): { accuracy: number | null; topK: number | null } {
  const accuracy = /top-1:\s+\d+\/\d+\s+=\s+([\d.]+)%/.exec(stdout);
  const topK = /top-5:\s+([\d.]+)%/.exec(stdout);
  return {
    accuracy: accuracy ? Number(accuracy[1]) / 100 : null,
    topK: topK ? Number(topK[1]) / 100 : null,
  };
}

export class ClassificationRebuildService {
  constructor(private readonly deps: RebuildDeps) {}

  /**
   * `existingRunId` is the row the request already created, so the Settings card can show "queued"
   * from the moment the button is pressed. Creating another here would leave the UI polling a row
   * nothing ever writes to.
   */
  async rebuild(
    triggeredById: string | null,
    existingRunId?: string,
  ): Promise<{ runId: string; deployed: boolean }> {
    const { runRepository, python } = this.deps;
    const run = existingRunId ? { id: existingRunId } : await runRepository.create({ triggeredById });
    let stage: RebuildStage = "taxonomy";

    const enter = async (next: RebuildStage) => {
      stage = next;
      await runRepository.update(run.id, { stage: next, status: "running" });
    };

    try {
      await enter("taxonomy");
      const taxonomy = await this.deps.importTaxonomy();
      logger.info({ runId: run.id, ...taxonomy }, "Rebuilt the category tree from the sheet");

      await enter("datasets");
      const datasets = await this.deps.buildDatasets();

      await enter("training");
      // Progress goes onto the row as it arrives. Training is minutes of silence otherwise, and
      // silence reads exactly like a hang — which is how a dead run went unnoticed for hours.
      const training = await python.run("train.py", [], (label) => {
        void runRepository
          .update(run.id, { message: label })
          .catch(() => undefined); // a dropped progress update must never fail the run itself
      });
      const { accuracy, topK } = parseTrainingOutput(training.stdout);

      await enter("index");
      await python.run("build_index.py", [], (label) => {
        void runRepository.update(run.id, { message: label }).catch(() => undefined);
      });

      await enter("export");
      await python.run("export_onnx.py");

      await enter("deploy");
      const previous = await runRepository.findLastDeployed();
      const baseline = previous?.evalAccuracy ?? null;

      // Strictly worse than what is already running: report it and stop. Equal is allowed through,
      // since a rebuild after a sheet edit that changes nothing measurable should still take effect.
      if (baseline !== null && accuracy !== null && accuracy < baseline) {
        await runRepository.update(run.id, {
          status: "skipped",
          evalAccuracy: accuracy,
          evalTopK: topK,
          baselineAccuracy: baseline,
          deployed: false,
          trainedRows: datasets.examples,
          finishedAt: new Date(),
          message:
            `Not deployed: the new model scores ${(accuracy * 100).toFixed(1)}% against ` +
            `${(baseline * 100).toFixed(1)}% for the one already running. The previous model is ` +
            `still in use. Its artifacts are kept so the two can be compared.`,
        });
        logger.warn({ runId: run.id, accuracy, baseline }, "Classifier rebuild did not beat the deployed model");
        return { runId: run.id, deployed: false };
      }

      await this.deps.reloadModel();

      await enter("reclassify");
      const reclassified = await this.deps.reclassify();

      await enter("done");
      await runRepository.update(run.id, {
        status: "succeeded",
        deployed: true,
        evalAccuracy: accuracy,
        evalTopK: topK,
        baselineAccuracy: baseline,
        trainedRows: datasets.examples,
        finishedAt: new Date(),
        // datasets.headings, not taxonomy.headings: the taxonomy import reports what it CREATED,
        // which is zero on every rebuild after the first. The dataset's count is the number of
        // classes the model can actually predict, which is what the number is meant to convey.
        message:
          `Deployed. ${datasets.headings} headings, ${datasets.examples} training examples, ` +
          `${reclassified.boqItems} draft BOQs re-classified.`,
      });
      logger.info({ runId: run.id, accuracy, baseline }, "Classifier rebuild deployed");
      return { runId: run.id, deployed: true };
    } catch (err) {
      // The stage is the useful part of a failure: "failed at training" and "failed at datasets"
      // are different problems with different fixes, and the exception alone does not say which.
      await runRepository.update(run.id, {
        stage,
        status: "failed",
        finishedAt: new Date(),
        // Summarised, not raw: execFile's message is the command line plus the whole of stderr,
        // which rendered as a wall of progress bars and warnings that buried the real error.
        message: summariseTrainerError(err instanceof Error ? err.message : String(err)),
      });
      logger.error({ runId: run.id, stage, err }, "Classifier rebuild failed");
      throw err;
    }
  }
}
