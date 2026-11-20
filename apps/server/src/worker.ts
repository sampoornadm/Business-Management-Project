import { env } from "./config/env.js";
import { hsnSacRefreshQueue, tenderReminderQueue } from "./infra/queue/queues.js";
import { startAiEnrichmentWorker } from "./infra/queue/workers/ai-enrichment.worker.js";
import { startClassificationRebuildWorker } from "./infra/queue/workers/classification-rebuild.worker.js";
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
const classificationRebuildWorker = startClassificationRebuildWorker();
const localDocsWatcher = env.LOCAL_DOCS_SYNC_ENABLED
  ? await startLocalDocsWatcher(env.BUSINESSES_ROOT_DIR)
  : undefined;
const incomingTendersWatcher = env.INCOMING_TENDERS_INGESTION_ENABLED
  ? await startIncomingTendersWatcher(env.BUSINESSES_ROOT_DIR)
  : undefined;
const aiEnrichmentWorker = env.AI_ENRICHMENT_ENABLED ? startAiEnrichmentWorker() : undefined;
const documentIndexingWorker = env.DOCUMENT_INDEXING_ENABLED ? startDocumentIndexingWorker() : undefined;

// Upgrading BullMQ to v6 removes legacy repeatable jobs (`add(..., { repeat })`), which v6 no
// longer manages, so delete any left in Redis by older builds before registering the schedulers
// below. Each scheduler's key is its job name; a legacy entry's key is a hash (or, from older v5
// builds, `name:jobId:endDate:tz:pattern`), so `key !== name` finds exactly the legacy ones.
// Without this the legacy entry keeps firing next to its scheduler and every reminder runs twice.
// ponytail: remove this cleanup in the v6 upgrade (getRepeatableJobs is gone there), only after
// every environment's worker has booted once with it.
for (const queue of [tenderReminderQueue, hsnSacRefreshQueue]) {
  for (const job of await queue.getRepeatableJobs()) {
    if (job.key !== job.name) await queue.removeRepeatableByKey(job.key);
  }
}

// Each schedule's id is its job name (one schedule per name; BullMQ types the id as a job name).
// Upserting a job scheduler by id is idempotent, so registering on every worker boot is safe and
// required (there is no separate one-time "seed the schedule" step in this deployment).
await tenderReminderQueue.upsertJobScheduler(
  "check-deadlines",
  { pattern: "0 7 * * *" },
  { name: "check-deadlines", data: {} },
);
// Separate, more frequent schedule for the "1 hour before" reminder — day-level thresholds only
// need checking once a day, but an hour-precision deadline needs checking often enough that no
// tender's window is missed between runs.
await tenderReminderQueue.upsertJobScheduler(
  "check-hourly-deadlines",
  { pattern: "*/15 * * * *" },
  { name: "check-hourly-deadlines", data: {} },
);
// Sundays 03:00 — this data changes rarely (GST Council notifications, not daily), so a weekly
// cadence is deliberately not configurable via env; the per-run enable/disable toggle lives in
// Settings (HSN_SAC_AUTO_REFRESH_ENABLED).
await hsnSacRefreshQueue.upsertJobScheduler(
  "refresh",
  { pattern: "0 3 * * 0" },
  { name: "refresh", data: {} },
);

logger.info(
  `Background worker process started (email queue, tender reminders${localDocsWatcher ? ", local docs sync" : ""}${incomingTendersWatcher ? ", incoming tenders ingestion" : ""}${aiEnrichmentWorker ? ", AI enrichment" : ""}${documentIndexingWorker ? ", document indexing" : ""}, classifier rebuild)`,
);

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down worker...`);
  await Promise.all([
    emailWorker.close(),
    tenderReminderWorker.close(),
    hsnSacRefreshWorker.close(),
    classificationRebuildWorker.close(),
    localDocsWatcher?.close(),
    incomingTendersWatcher?.close(),
    aiEnrichmentWorker?.close(),
    documentIndexingWorker?.close(),
  ]);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
