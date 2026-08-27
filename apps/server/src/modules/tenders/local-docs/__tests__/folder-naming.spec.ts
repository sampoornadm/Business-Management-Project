import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  documentTypeForFolder,
  ensureTenderFolders,
  expandHome,
  tenderFolderName,
  tenderNumberFromFolderName,
} from "../folder-naming.js";

describe("tenderFolderName", () => {
  it("joins the tender number and title with ' - '", () => {
    expect(tenderFolderName({ tenderNumber: "1400000004", title: "Simple Title" })).toBe(
      "1400000004 - Simple Title",
    );
  });

  it("sanitizes filesystem-illegal characters in the title but not the tender number", () => {
    expect(tenderFolderName({ tenderNumber: "1400000004", title: "MJ/C06/2025/1004-FLANGE" })).toBe(
      "1400000004 - MJ-C06-2025-1004-FLANGE",
    );
  });

  it("truncates very long titles", () => {
    const longTitle = "A".repeat(200);
    const folderName = tenderFolderName({ tenderNumber: "TND-1", title: longTitle });
    expect(folderName.length).toBeLessThan(120);
    expect(folderName.startsWith("TND-1 - ")).toBe(true);
  });
});

describe("tenderNumberFromFolderName", () => {
  it("extracts the leading tender number token", () => {
    expect(tenderNumberFromFolderName("1400000004 - MJ-C06-2025-1004-FLANGE")).toBe("1400000004");
  });

  it("still resolves correctly even if the title portion has gone stale after a rename", () => {
    expect(tenderNumberFromFolderName("1400000004 - Some Old Title That Changed Later")).toBe(
      "1400000004",
    );
  });

  it("returns null when there's no ' - ' separator", () => {
    expect(tenderNumberFromFolderName("NoSeparatorHere")).toBeNull();
  });
});

describe("documentTypeForFolder", () => {
  it("maps known folder names case-insensitively", () => {
    expect(documentTypeForFolder("BOQ")).toBe("BOQ");
    expect(documentTypeForFolder("boq")).toBe("BOQ");
    expect(documentTypeForFolder("Technical Specs")).toBe("TECHNICAL_SPECS");
    expect(documentTypeForFolder("tender notice")).toBe("TENDER_NOTICE");
  });

  it("defaults to GENERAL for an unrecognized folder name", () => {
    expect(documentTypeForFolder("Some Random Folder")).toBe("GENERAL");
  });

  it("defaults to GENERAL when there's no subfolder at all", () => {
    expect(documentTypeForFolder(undefined)).toBe("GENERAL");
  });
});

describe("expandHome", () => {
  it("expands a leading ~ to the home directory", () => {
    expect(expandHome("~/BMP-Tenders")).toBe(path.join(os.homedir(), "BMP-Tenders"));
  });

  it("leaves absolute paths untouched", () => {
    expect(expandHome("/var/data/tenders")).toBe("/var/data/tenders");
  });
});

describe("ensureTenderFolders", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), "bmp-docs-test-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("creates the tender folder under <businessCode>/tenders/, with a subfolder for every document type", async () => {
    await ensureTenderFolders(rootDir, "BIZ1", { tenderNumber: "TND-1", title: "Road Works" });

    const tenderDir = path.join(rootDir, "BIZ1", "tenders", "TND-1 - Road Works");
    const subfolders = await readdir(tenderDir);
    expect(subfolders.sort()).toEqual(
      [
        "Addendum",
        "Bills",
        "BOQ",
        "Corrigendum",
        "Drawings",
        "General",
        "NIT",
        "Technical Specs",
        "Tender Notice",
        "Undertakings",
      ].sort(),
    );
  });

  it("keeps different businesses' tender folders separate", async () => {
    await ensureTenderFolders(rootDir, "BIZ1", { tenderNumber: "TND-3", title: "Shared Number" });
    await ensureTenderFolders(rootDir, "BIZ2", { tenderNumber: "TND-3", title: "Shared Number" });

    const bizOneDir = path.join(rootDir, "BIZ1", "tenders", "TND-3 - Shared Number");
    const bizTwoDir = path.join(rootDir, "BIZ2", "tenders", "TND-3 - Shared Number");
    await expect(readdir(bizOneDir)).resolves.toHaveLength(10);
    await expect(readdir(bizTwoDir)).resolves.toHaveLength(10);
  });

  it("is idempotent when called again for the same tender", async () => {
    const tender = { tenderNumber: "TND-2", title: "Bridge Works" };
    await ensureTenderFolders(rootDir, "BIZ1", tender);
    await expect(ensureTenderFolders(rootDir, "BIZ1", tender)).resolves.not.toThrow();
  });
});
