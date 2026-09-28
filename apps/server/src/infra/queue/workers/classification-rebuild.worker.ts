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
 * Runs the classifier rebuild started from the Settings page.
 *
 * The dependencies are wired here rather than inside ClassificationRebuildService so that service
 * does not import boq.module — boq.module already imports classification.module for the classifier
 * itself, and importing back would close a cycle that crashes at startup (the same trap
 * boq.module.ts documents for items/rfq).
 *
 * Concurrency 1, deliberately: the trainer wants the whole GPU, and two of them would both be slow
 * and race for ml/models/current.
 */
export function startClassificationRebuildWorker(): Worker {
  const runRepository = new ClassificationRunRepository(prisma);

  const service = new ClassificationRebuildService({
    runRepository,
    python: pythonRunner,
    importTaxonomy: async () => {
      const sheet = HsnTaxonomyImportService.resolveSheetPath(REPO_ROOT);
      const result = await hsnTaxonomyImportService.importFromSheet(sheet);
      return { chapters: result.chaptersCreated, headings: result.headingsCreated };
    },
    buildDatasets: () => buildDatasets(REPO_ROOT, referenceDataRepository),
    reloadModel: () => classificationService.reload(),
    reclassify: () => reclassifyCurrentWork(),
  });

  const worker = new Worker<{ runId: string; triggeredById: string | null }>(
    CLASSIFICATION_REBUILD_QUEUE_NAME,
    async (job) => {
      await service.rebuild(job.data.triggeredById, job.data.runId);
    },
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Classifier rebuild job failed");
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
  const boqs = await prisma.boq.findMany({
    where: { isCurrent: true, tender: { status: "DRAFT" } },
    select: { id: true, businessId: true },
  });

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
