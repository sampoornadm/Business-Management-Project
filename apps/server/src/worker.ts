import { env } from "./config/env.js";
import { tenderReminderQueue } from "./infra/queue/queues.js";
import { startAiEnrichmentWorker } from "./infra/queue/workers/ai-enrichment.worker.js";
import { startEmailWorker } from "./infra/queue/workers/email.worker.js";
import { startTenderReminderWorker } from "./infra/queue/workers/tender-reminder.worker.js";
import { startLocalDocsWatcher } from "./modules/tenders/local-docs/docs-watcher.service.js";
import { startIncomingTendersWatcher } from "./modules/tenders/local-docs/incoming-tenders.service.js";
import { logger } from "./shared/logger/logger.js";

const emailWorker = startEmailWorker();
const tenderReminderWorker = startTenderReminderWorker();
const localDocsWatcher = env.LOCAL_DOCS_SYNC_ENABLED
  ? await startLocalDocsWatcher(env.BUSINESSES_ROOT_DIR)
  : undefined;
const incomingTendersWatcher = env.INCOMING_TENDERS_INGESTION_ENABLED
  ? await startIncomingTendersWatcher(env.BUSINESSES_ROOT_DIR)
  : undefined;
const aiEnrichmentWorker = env.AI_ENRICHMENT_ENABLED ? startAiEnrichmentWorker() : undefined;

// Idempotent: BullMQ dedupes repeatable jobs by pattern + jobId, so
// re-registering on every worker boot is safe and required (there is no
// separate one-time "seed the schedule" step in this deployment).
await tenderReminderQueue.add(
  "check-deadlines",
  {},
  { repeat: { pattern: "0 7 * * *" }, jobId: "tender-deadline-check" },
);

logger.info(
  `Background worker process started (email queue, tender reminders${localDocsWatcher ? ", local docs sync" : ""}${incomingTendersWatcher ? ", incoming tenders ingestion" : ""}${aiEnrichmentWorker ? ", AI enrichment" : ""})`,
);

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down worker...`);
  await Promise.all([
    emailWorker.close(),
    tenderReminderWorker.close(),
    localDocsWatcher?.close(),
    incomingTendersWatcher?.close(),
    aiEnrichmentWorker?.close(),
  ]);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
