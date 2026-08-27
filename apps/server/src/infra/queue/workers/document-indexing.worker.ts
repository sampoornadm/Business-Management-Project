import { Worker } from "bullmq";

import { indexAttachment } from "../../../modules/attachments/document-indexing.service.js";
import { logger } from "../../../shared/logger/logger.js";
import { redis } from "../../redis/client.js";
import { DOCUMENT_INDEXING_QUEUE_NAME, type DocumentIndexingJobPayload } from "../queues.js";

export function startDocumentIndexingWorker(): Worker<DocumentIndexingJobPayload, void, "index-document"> {
  const worker = new Worker<DocumentIndexingJobPayload, void, "index-document">(
    DOCUMENT_INDEXING_QUEUE_NAME,
    async (job) => {
      await indexAttachment(job.data.attachmentId);
    },
    // Single-machine, CPU-only inference — same reasoning as ai-enrichment.worker.ts.
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, attachmentId: job?.data.attachmentId, err }, "Document indexing job failed");
  });

  return worker;
}
