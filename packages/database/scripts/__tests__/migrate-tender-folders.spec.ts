import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// NOTE: 4 levels up — this file lives in packages/database/scripts/__tests__/,
// so reaching apps/server/ at the repo root needs 4 "../", not 3 (the
// migrate-tender-folders.ts implementation itself lives one level shallower,
// in packages/database/scripts/, so it correctly uses 3).
vi.mock("../../../../apps/server/src/modules/tenders/local-docs/docs-watcher.service.js", () => ({
  listAllTendersForFolderSync: vi.fn(),
}));

describe("planMigration", () => {
  let oldRootDir: string;

  beforeEach(async () => {
    oldRootDir = await mkdtemp(path.join(tmpdir(), "bmp-migrate-test-"));
    const { listAllTendersForFolderSync } = await import(
      "../../../../apps/server/src/modules/tenders/local-docs/docs-watcher.service.js"
    );
    vi.mocked(listAllTendersForFolderSync).mockResolvedValue([]);
  });

  afterEach(async () => {
    await rm(oldRootDir, { recursive: true, force: true });
  });

  it("plans a move for each folder that resolves to a tender, grouped by business code", async () => {
    await mkdir(path.join(oldRootDir, "TND-1 - Road Works"), { recursive: true });
    await mkdir(path.join(oldRootDir, "TND-2 - Bridge Works"), { recursive: true });

    const { listAllTendersForFolderSync } = await import(
      "../../../../apps/server/src/modules/tenders/local-docs/docs-watcher.service.js"
    );
    vi.mocked(listAllTendersForFolderSync).mockResolvedValue([
      { tenderNumber: "TND-1", title: "Road Works", businessCode: "ARCHIE" },
      { tenderNumber: "TND-2", title: "Bridge Works", businessCode: "SAMSON" },
    ]);

    const { planMigration } = await import("../migrate-tender-folders.js");
    const plan = await planMigration(oldRootDir);

    expect(plan.moves).toEqual(
      expect.arrayContaining([
        {
          from: path.join(oldRootDir, "TND-1 - Road Works"),
          to: expect.stringContaining(path.join("ARCHIE", "tenders", "TND-1 - Road Works")),
        },
        {
          from: path.join(oldRootDir, "TND-2 - Bridge Works"),
          to: expect.stringContaining(path.join("SAMSON", "tenders", "TND-2 - Bridge Works")),
        },
      ]),
    );
    expect(plan.unresolved).toEqual([]);
  });

  it("reports a folder that doesn't resolve to any tender as unresolved, without planning a move for it", async () => {
    await mkdir(path.join(oldRootDir, "TND-UNKNOWN - Mystery"), { recursive: true });

    // beforeEach already mocked listAllTendersForFolderSync to resolve []; no tender
    // in the system matches "TND-UNKNOWN", so this folder must be reported unresolved.

    const { planMigration } = await import("../migrate-tender-folders.js");
    const plan = await planMigration(oldRootDir);

    expect(plan.moves).toEqual([]);
    expect(plan.unresolved).toEqual(["TND-UNKNOWN - Mystery"]);
  });

  it("ignores non-directory entries at the root (e.g. stray files like .DS_Store)", async () => {
    await writeFile(path.join(oldRootDir, ".DS_Store"), "");

    const { planMigration } = await import("../migrate-tender-folders.js");
    const plan = await planMigration(oldRootDir);

    expect(plan.moves).toEqual([]);
    expect(plan.unresolved).toEqual([]);
  });
});

describe("executeMigration", () => {
  let oldRootDir: string;
  let newRootDir: string;

  beforeEach(async () => {
    oldRootDir = await mkdtemp(path.join(tmpdir(), "bmp-migrate-test-old-"));
    newRootDir = await mkdtemp(path.join(tmpdir(), "bmp-migrate-test-new-"));
  });

  afterEach(async () => {
    await rm(oldRootDir, { recursive: true, force: true });
    await rm(newRootDir, { recursive: true, force: true });
  });

  // Regression test for a Critical finding: startLocalDocsWatcher()'s reconcileFolders() runs on
  // every boot and unconditionally pre-creates the full empty subfolder skeleton
  // (<businessCode>/tenders/<tenderFolder>/{BOQ,Drawings,...}) for every tender, whether or not
  // that tender's old-style folder has been migrated yet. So by the time this script actually
  // runs, `move.to` almost always already exists as a non-empty directory — a blind top-level
  // `rename(move.from, move.to)` throws ENOTEMPTY against that. This test pre-creates exactly
  // that collision (including an asymmetric sibling skeleton folder, "Drawings", that has no
  // counterpart in the source) and asserts the migration still succeeds.
  it("merges an old tender folder's contents into a destination that already has an empty skeleton (reconcileFolders collision)", async () => {
    const from = path.join(oldRootDir, "TND-1 - Road Works");
    const to = path.join(newRootDir, "ARCHIE", "tenders", "TND-1 - Road Works");

    await mkdir(path.join(from, "BOQ"), { recursive: true });
    await writeFile(path.join(from, "BOQ", "quote.pdf"), "quote contents");

    // Simulates reconcileFolders() having already run: destination skeleton exists, empty,
    // including a sibling subfolder ("Drawings") absent from the source.
    await mkdir(path.join(to, "BOQ"), { recursive: true });
    await mkdir(path.join(to, "Drawings"), { recursive: true });

    const { executeMigration } = await import("../migrate-tender-folders.js");
    const plan = { moves: [{ from, to }], unresolved: [] };

    await expect(executeMigration(plan, oldRootDir)).resolves.not.toThrow();

    const moved = await readFile(path.join(to, "BOQ", "quote.pdf"), "utf8");
    expect(moved).toBe("quote contents");

    await expect(stat(from)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
