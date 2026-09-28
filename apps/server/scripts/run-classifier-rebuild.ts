#!/usr/bin/env tsx
/**
 * Runs the Settings "Update" rebuild directly, without the queue.
 *
 *   pnpm exec dotenv -e .env -- pnpm --filter @bmp/server exec tsx scripts/run-classifier-rebuild.ts
 *
 * Same code path the button triggers, minus HTTP and Redis. Useful for checking a sheet edit before
 * handing it to the button, and for verifying the pipeline after changing any step of it — the
 * stages only prove they work together by running together.
 *
 * Takes several minutes: it retrains the model.
 */
import { createRebuildService } from "../src/infra/queue/workers/classification-rebuild.worker.js";
import { prisma } from "../src/infra/prisma/client.js";

async function main() {
  const started = Date.now();
  const result = await createRebuildService().rebuild(null);

  const run = await prisma.classificationRun.findUnique({ where: { id: result.runId } });
  console.warn(
    [
      `run ${result.runId}`,
      `  status:   ${run?.status} (stage: ${run?.stage})`,
      `  deployed: ${run?.deployed}`,
      `  accuracy: ${run?.evalAccuracy ?? "—"} (previous deployed: ${run?.baselineAccuracy ?? "none"})`,
      `  trained:  ${run?.trainedRows ?? "—"} examples`,
      `  message:  ${run?.message ?? "—"}`,
      `  took:     ${((Date.now() - started) / 60000).toFixed(1)} min`,
    ].join("\n"),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
