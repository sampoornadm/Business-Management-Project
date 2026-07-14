import { mkdir, readdir, rename, rmdir } from "node:fs/promises";
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

// `move.to` may already exist as a non-empty directory: startLocalDocsWatcher()'s
// reconcileFolders() creates the full <BOQ,Drawings,General,...> skeleton for every tender on
// every boot, regardless of whether that tender's old-style folder has been migrated yet. A
// blind top-level `rename(move.from, move.to)` throws ENOTEMPTY against a pre-existing
// destination, so instead we merge one level deep: ensure `move.to` exists, then rename each
// entry directly inside `move.from` (files and subfolders alike — old tender folders are only
// ever one level deep, see ensureTenderFolders in folder-naming.ts) into the same-named path
// under `move.to`. A subfolder rename still succeeds via POSIX rename semantics as long as the
// destination subfolder is empty, which it will be since reconcileFolders only ever creates
// empty skeleton folders.
export async function executeMigration(plan: MigrationPlan, oldRootDir: string): Promise<void> {
  for (const move of plan.moves) {
    await mkdir(move.to, { recursive: true });
    const entries = await readdir(move.from, { withFileTypes: true });
    for (const entry of entries) {
      await rename(path.join(move.from, entry.name), path.join(move.to, entry.name));
    }
    await rmdir(move.from);
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
