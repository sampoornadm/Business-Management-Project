import { Worker } from "bullmq";

import { ServiceUnavailableError } from "../../../core/errors/HttpErrors.js";
import { boqEnrichmentService } from "../../../modules/boq/boq.module.js";
import { logger } from "../../../shared/logger/logger.js";
import { redis } from "../../redis/client.js";
import { AI_ENRICHMENT_QUEUE_NAME, type AiEnrichmentJobPayload } from "../queues.js";

export function startAiEnrichmentWorker(): Worker<AiEnrichmentJobPayload, void, "enrich-boq"> {
  const worker = new Worker<AiEnrichmentJobPayload, void, "enrich-boq">(
    AI_ENRICHMENT_QUEUE_NAME,
    async (job) => {
      try {
        await boqEnrichmentService.enrichBoq(job.data.boqId, job.data.businessId);
      } catch (err) {
        // AI is an optional enhancement: if Ollama is down or a model isn't pulled, log
        // and complete the job. Retrying would just hammer a service that isn't there,
        // and the BOQ is perfectly usable without enrichment.
        if (err instanceof ServiceUnavailableError) {
          logger.warn({ boqId: job.data.boqId, err: err.message }, "BOQ enrichment skipped — Ollama unavailable");
          return;
        }
        throw err;
      }
    },
    // Single-machine, CPU-only inference: more than one concurrent job just makes both slower.
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, boqId: job?.data.boqId, err }, "BOQ enrichment job failed");
  });

  return worker;
}
