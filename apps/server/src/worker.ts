import { env } from "./config/env.js";
import { hsnSacRefreshQueue, tenderReminderQueue } from "./infra/queue/queues.js";
import { startAiEnrichmentWorker } from "./infra/queue/workers/ai-enrichment.worker.js";
import { startDocumentIndexingWorker } from "./infra/queue/workers/document-indexing.worker.js";
import { startEmailWorker } from "./infra/queue/workers/email.worker.js";
import { startHsnSacRefreshWorker } from "./infra/queue/workers/hsn-sac-refresh.worker.js";
import { startTenderReminderWorker } from "./infra/queue/workers/tender-reminder.worker.js";
import { startLocalDocsWatcher } from "./modules/tenders/local-docs/docs-watcher.service.js";
import { startIncomingTendersWatcher } from "./modules/tenders/local-docs/incoming-tenders.service.js";
import { logger } from "./shared/logger/logger.js";

const emailWorker = startEmailWorker();
const tenderReminderWorker = startTenderReminderWorker();
const hsnSacRefreshWorker = startHsnSacRefreshWorker();
const localDocsWatcher = env.LOCAL_DOCS_SYNC_ENABLED
  ? await startLocalDocsWatcher(env.BUSINESSES_ROOT_DIR)
  : undefined;
const incomingTendersWatcher = env.INCOMING_TENDERS_INGESTION_ENABLED
  ? await startIncomingTendersWatcher(env.BUSINESSES_ROOT_DIR)
  : undefined;
const aiEnrichmentWorker = env.AI_ENRICHMENT_ENABLED ? startAiEnrichmentWorker() : undefined;
const documentIndexingWorker = env.DOCUMENT_INDEXING_ENABLED ? startDocumentIndexingWorker() : undefined;

// Idempotent: BullMQ dedupes repeatable jobs by pattern + jobId, so
// re-registering on every worker boot is safe and required (there is no
// separate one-time "seed the schedule" step in this deployment).
await tenderReminderQueue.add(
  "check-deadlines",
  {},
  { repeat: { pattern: "0 7 * * *" }, jobId: "tender-deadline-check" },
);
// Separate, more frequent schedule for the "1 hour before" reminder — day-level thresholds only
// need checking once a day, but an hour-precision deadline needs checking often enough that no
// tender's window is missed between runs.
await tenderReminderQueue.add(
  "check-hourly-deadlines",
  {},
  { repeat: { pattern: "*/15 * * * *" }, jobId: "tender-hourly-deadline-check" },
);
// Sundays 03:00 — this data changes rarely (GST Council notifications, not daily), so a weekly
// cadence is deliberately not configurable via env; the per-run enable/disable toggle lives in
// Settings (HSN_SAC_AUTO_REFRESH_ENABLED).
await hsnSacRefreshQueue.add(
  "refresh",
  {},
  { repeat: { pattern: "0 3 * * 0" }, jobId: "hsn-sac-weekly-refresh" },
);

logger.info(
  `Background worker process started (email queue, tender reminders${localDocsWatcher ? ", local docs sync" : ""}${incomingTendersWatcher ? ", incoming tenders ingestion" : ""}${aiEnrichmentWorker ? ", AI enrichment" : ""}${documentIndexingWorker ? ", document indexing" : ""})`,
);

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down worker...`);
  await Promise.all([
    emailWorker.close(),
    tenderReminderWorker.close(),
    hsnSacRefreshWorker.close(),
    localDocsWatcher?.close(),
    incomingTendersWatcher?.close(),
    aiEnrichmentWorker?.close(),
    documentIndexingWorker?.close(),
  ]);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
