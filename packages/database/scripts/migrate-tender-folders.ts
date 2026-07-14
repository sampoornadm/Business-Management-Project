import { readdir, rename, rmdir } from "node:fs/promises";
import path from "node:path";

import { listAllTendersForFolderSync } from "../../../apps/server/src/modules/tenders/local-docs/docs-watcher.service.js";
import { tenderNumberFromFolderName } from "../../../apps/server/src/modules/tenders/local-docs/folder-naming.js";

export interface MigrationPlan {
  moves: Array<{ from: string; to: string }>;
  unresolved: string[];
}

export async function planMigration(oldRootDir: string, newRootDir: string = oldRootDir): Promise<MigrationPlan> {
  const entries = await readdir(oldRootDir, { withFileTypes: true });
  const tenders = await listAllTendersForFolderSync();
  const businessCodeByTenderNumber = new Map(tenders.map((tender) => [tender.tenderNumber, tender.businessCode]));

  const moves: MigrationPlan["moves"] = [];
  const unresolved: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const tenderNumber = tenderNumberFromFolderName(entry.name);
    const businessCode = tenderNumber ? businessCodeByTenderNumber.get(tenderNumber) : undefined;
    if (!businessCode) {
      unresolved.push(entry.name);
      continue;
    }

    moves.push({
      from: path.join(oldRootDir, entry.name),
      to: path.join(newRootDir, businessCode, "tenders", entry.name),
    });
  }

  return { moves, unresolved };
}

export async function executeMigration(plan: MigrationPlan, oldRootDir: string): Promise<void> {
  for (const move of plan.moves) {
    await rename(move.from, move.to);
  }
  const remaining = await readdir(oldRootDir);
  if (remaining.length === 0) {
    await rmdir(oldRootDir);
  }
}

function printPlan(plan: MigrationPlan): void {
  console.warn(`Planned moves (${plan.moves.length}):`);
  for (const move of plan.moves) {
    console.warn(`  ${move.from}\n    -> ${move.to}`);
  }
  if (plan.unresolved.length > 0) {
    console.warn(`\nUnresolved (${plan.unresolved.length}) — left in place, not moved:`);
    for (const name of plan.unresolved) {
      console.warn(`  ${name}`);
    }
  }
}

async function main(): Promise<void> {
  const { env } = await import("../../../apps/server/src/config/env.js");
  const { expandHome } = await import("../../../apps/server/src/modules/tenders/local-docs/folder-naming.js");

  const oldRootDir = expandHome("~/BMP-Tenders");
  const newRootDir = expandHome(env.BUSINESSES_ROOT_DIR);
  const shouldExecute = process.argv.includes("--execute");

  const plan = await planMigration(oldRootDir, newRootDir);
  printPlan(plan);

  if (!shouldExecute) {
    console.warn("\nDry run only — nothing was moved. Re-run with --execute to perform these moves for real.");
    return;
  }

  console.warn("\nExecuting...");
  await executeMigration(plan, oldRootDir);
  console.warn("Done.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Force-exit once done: main() imports docs-watcher.service.ts (for
  // listAllTendersForFolderSync), which — as a side effect of that module's
  // other top-level imports (attachmentsService, auditService) — opens
  // Redis/S3 connections this script never actually uses. Those keep the
  // event loop alive indefinitely, so without an explicit exit the process
  // would never return control to the terminal after printing the plan.
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error("migrate-tender-folders failed:", error);
      process.exit(1);
    });
}
