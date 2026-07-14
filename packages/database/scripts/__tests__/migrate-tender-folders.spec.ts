import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(oldRootDir, ".DS_Store"), "");

    const { planMigration } = await import("../migrate-tender-folders.js");
    const plan = await planMigration(oldRootDir);

    expect(plan.moves).toEqual([]);
    expect(plan.unresolved).toEqual([]);
  });
});
