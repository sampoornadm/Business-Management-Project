import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config/env.js", () => ({ env: { TEMPLATES_ROOT_DIR: "" } }));

describe("getTemplateStatus", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "bmp-templates-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("reports exists: false when the template file is absent", async () => {
    const { env } = await import("../../../config/env.js");
    (env as { TEMPLATES_ROOT_DIR: string }).TEMPLATES_ROOT_DIR = tempDir;
    const { getTemplateStatus } = await import("../document-generation.service.js");

    const status = await getTemplateStatus("undertaking");

    expect(status.exists).toBe(false);
    expect(status.lastModifiedAt).toBeNull();
    expect(status.filename).toBe("undertaking.docx");
  });

  it("reports exists: true with the file's mtime when present", async () => {
    const { env } = await import("../../../config/env.js");
    (env as { TEMPLATES_ROOT_DIR: string }).TEMPLATES_ROOT_DIR = tempDir;
    await writeFile(path.join(tempDir, "undertaking.docx"), "fake docx bytes");
    const { getTemplateStatus } = await import("../document-generation.service.js");

    const status = await getTemplateStatus("undertaking");

    expect(status.exists).toBe(true);
    expect(status.lastModifiedAt).not.toBeNull();
    expect(new Date(status.lastModifiedAt!).getTime()).not.toBeNaN();
  });
});
