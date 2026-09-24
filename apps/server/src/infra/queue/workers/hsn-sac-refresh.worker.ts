import { Worker } from "bullmq";

import { hsnSacImportService } from "../../../modules/reference-data/reference-data.module.js";
import { settingsService } from "../../../modules/settings/settings.module.js";
import { logger } from "../../../shared/logger/logger.js";
import { redis } from "../../redis/client.js";
import { HSN_SAC_REFRESH_QUEUE_NAME } from "../queues.js";

export function startHsnSacRefreshWorker(): Worker {
  const worker = new Worker(
    HSN_SAC_REFRESH_QUEUE_NAME,
    async () => {
      const autoRefreshEnabled = await settingsService.get<boolean>("HSN_SAC_AUTO_REFRESH_ENABLED");
      if (!autoRefreshEnabled) return;
      const result = await hsnSacImportService.fetchAndImport(null);
      if (result) {
        logger.info(result, "Scheduled HSN/SAC refresh imported new data");
      } else {
        logger.info("Scheduled HSN/SAC refresh: source unchanged");
      }
    },
    { connection: redis },
  );
  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "HSN/SAC refresh job failed");
  });
  return worker;
}
