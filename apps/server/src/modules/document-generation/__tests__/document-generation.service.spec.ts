import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import PizZip from "pizzip";
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

function buildTestDocxBuffer(bodyText: string): Buffer {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${bodyText}</w:t></w:r></w:p></w:body>` +
      "</w:document>",
  );
  return zip.generate({ type: "nodebuffer" });
}

describe("fillDocxTemplate", () => {
  it("replaces {{tag}} placeholders with the given values", async () => {
    const { fillDocxTemplate } = await import("../document-generation.service.js");
    const template = buildTestDocxBuffer("Dear {{clientOrganizationName}}, re: {{tenderNumber}}.");

    const result = fillDocxTemplate(template, {
      clientOrganizationName: "Acme Corp",
      tenderNumber: "TEN-001",
    });

    const resultZip = new PizZip(result);
    const documentXml = resultZip.file("word/document.xml")!.asText();
    expect(documentXml).toContain("Dear Acme Corp, re: TEN-001.");
    expect(documentXml).not.toContain("{{clientOrganizationName}}");
    expect(documentXml).not.toContain("{{tenderNumber}}");
  });

  it("renders unresolved tags outside the provided data as blank instead of failing", async () => {
    const { fillDocxTemplate } = await import("../document-generation.service.js");
    const template = buildTestDocxBuffer("Hello {{unknownTag}}.");

    expect(fillDocxTemplate(template, {})).toBeInstanceOf(Buffer);
  });
});
