import path from "node:path";
import { fileURLToPath } from "node:url";

import { Worker } from "bullmq";

import { boqEnrichmentService } from "../../../modules/boq/boq.module.js";
import { classificationService } from "../../../modules/classification/classification.module.js";
import { pythonRunner } from "../../../modules/classification/classification.python.js";
import { ClassificationRebuildService } from "../../../modules/classification/classification.rebuild.service.js";
import { ClassificationRunRepository } from "../../../modules/classification/classification.repository.js";
import { buildDatasets } from "../../../modules/reference-data/hsn-dataset.writer.js";
import { HsnTaxonomyImportService } from "../../../modules/reference-data/hsn-taxonomy-import.service.js";
import {
  hsnTaxonomyImportService,
  referenceDataRepository,
} from "../../../modules/reference-data/reference-data.module.js";
import { logger } from "../../../shared/logger/logger.js";
import { prisma } from "../../prisma/client.js";
import { redis } from "../../redis/client.js";
import { CLASSIFICATION_REBUILD_QUEUE_NAME } from "../queues.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");

/**
 * Wires the rebuild's dependencies.
 *
 * They are composed here rather than inside ClassificationRebuildService so that service does not
 * import boq.module — boq.module already imports classification.module for the classifier itself,
 * and importing back would close a startup cycle (the same trap boq.module.ts documents for
 * items/rfq).
 *
 * Exported so the rebuild can also run without a queue: scripts/run-classifier-rebuild.ts uses it
 * to exercise the real pipeline end to end, which is the only way to find out whether the Python
 * steps, the sheet and the re-classification actually work together.
 */
export function createRebuildService(): ClassificationRebuildService {
  return new ClassificationRebuildService({
    runRepository: new ClassificationRunRepository(prisma),
    python: pythonRunner,
    importTaxonomy: async () => {
      const sheet = HsnTaxonomyImportService.resolveSheetPath(REPO_ROOT);
      const result = await hsnTaxonomyImportService.importFromSheet(sheet);
      // Created counts, so zero on every rebuild after the first. The message the card shows
      // uses the dataset's class count instead; these are here for the log.
      return { chapters: result.chaptersCreated, headings: result.headingsCreated };
    },
    buildDatasets: () => buildDatasets(REPO_ROOT, referenceDataRepository),
    reloadModel: () => classificationService.reload(),
    reclassify: () => reclassifyCurrentWork(),
  });
}

/**
 * Concurrency 1, deliberately: the trainer wants the whole GPU, and two runs would both be slow and
 * race for ml/models/current.
 */
export function startClassificationRebuildWorker(): Worker {
  const service = createRebuildService();
  const runRepository = new ClassificationRunRepository(prisma);

  // A run is only marked failed by the service's catch block, which needs the error to be thrown.
  // It is not, when the process is killed — `tsx watch` restarting on a file change is enough, and
  // in development that happens constantly. The row then sits at "running" forever and
  // hasRunInProgress() refuses every later attempt, so one lost job disables the button for good.
  // Reclaiming on boot is what makes that recoverable without touching the database by hand.
  void runRepository
    .failAbandonedRuns()
    .then((count) => {
      if (count > 0) logger.warn({ count }, "Marked abandoned classifier rebuilds as failed");
    })
    .catch((err) => logger.error({ err }, "Could not reclaim abandoned classifier rebuilds"));

  const worker = new Worker<{ runId: string; triggeredById: string | null }>(
    CLASSIFICATION_REBUILD_QUEUE_NAME,
    async (job) => {
      await service.rebuild(job.data.triggeredById, job.data.runId);
    },
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Classifier rebuild job failed");
    // The second net, and the one that catches a stall: BullMQ reports the job dead even when the
    // process that owned it never got to record anything. updateMany is scoped to unfinished rows,
    // so this cannot overwrite a run that actually completed.
    const runId = job?.data?.runId;
    if (runId) {
      void runRepository
        .failRun(runId, `Rebuild stopped: ${err.message}. Nothing was deployed.`)
        .catch((updateErr) => logger.error({ runId, err: updateErr }, "Could not record the failure"));
    }
  });
  return worker;
}

/**
 * Re-runs enrichment over the BOQs that are still being worked on.
 *
 * Only current BOQs of DRAFT tenders: once a tender is submitted its codes are part of what was
 * quoted, and re-deriving them afterwards would rewrite history rather than improve anything.
 *
 * The count returned is BOQs, not lines — enrichBoq does not report how many items it touched, and
 * inventing a line count by counting rows separately would be a number nobody verified.
 */
async function reclassifyCurrentWork(): Promise<{ items: number; boqItems: number }> {
  // Per business, because the Prisma client refuses a Boq read with no businessId in its where
  // clause — the multi-tenant guard, and it is right to: a rebuild is global but the data is not.
  const businesses = await prisma.business.findMany({ select: { id: true } });
  const boqs: { id: string; businessId: string }[] = [];

  for (const business of businesses) {
    const found = await prisma.boq.findMany({
      where: { businessId: business.id, isCurrent: true, tender: { status: "DRAFT" } },
      select: { id: true, businessId: true },
    });
    boqs.push(...found);
  }

  let boqItems = 0;
  for (const boq of boqs) {
    try {
      await boqEnrichmentService.enrichBoq(boq.id, boq.businessId);
      boqItems += 1;
    } catch (err) {
      // One unenrichable BOQ must not abandon the rest; the rebuild itself already succeeded.
      logger.warn({ boqId: boq.id, err }, "Skipped a BOQ while re-classifying after a rebuild");
    }
  }

  return { items: 0, boqItems };
}
