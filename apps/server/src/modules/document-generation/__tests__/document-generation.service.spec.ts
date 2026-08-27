import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import PizZip from "pizzip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config/env.js", () => ({ env: { BUSINESSES_ROOT_DIR: "" } }));

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
    (env as { BUSINESSES_ROOT_DIR: string }).BUSINESSES_ROOT_DIR = tempDir;
    const { getTemplateStatus } = await import("../document-generation.service.js");

    const status = await getTemplateStatus("ARCHIE", "undertaking");

    expect(status.exists).toBe(false);
    expect(status.lastModifiedAt).toBeNull();
    expect(status.filename).toBe("undertaking.docx");
    expect(status.path).toBe(path.join(tempDir, "ARCHIE", "templates", "undertaking.docx"));
  });

  it("reports exists: true with the file's mtime when present", async () => {
    const { env } = await import("../../../config/env.js");
    (env as { BUSINESSES_ROOT_DIR: string }).BUSINESSES_ROOT_DIR = tempDir;
    await mkdir(path.join(tempDir, "ARCHIE", "templates"), { recursive: true });
    await writeFile(path.join(tempDir, "ARCHIE", "templates", "undertaking.docx"), "fake docx bytes");
    const { getTemplateStatus } = await import("../document-generation.service.js");

    const status = await getTemplateStatus("ARCHIE", "undertaking");

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

  it("renders unresolved tags as an empty string rather than the literal word 'undefined'", async () => {
    const { fillDocxTemplate } = await import("../document-generation.service.js");
    const template = buildTestDocxBuffer("Hello {{unknownTag}}.");

    const result = fillDocxTemplate(template, {});

    const resultZip = new PizZip(result);
    const documentXml = resultZip.file("word/document.xml")!.asText();
    expect(documentXml).toContain("Hello .");
    expect(documentXml).not.toContain("undefined");
    expect(documentXml).not.toContain("{{unknownTag}}");
  });
});

describe("generateUndertaking", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "bmp-templates-"));
    const { env } = await import("../../../config/env.js");
    (env as { BUSINESSES_ROOT_DIR: string }).BUSINESSES_ROOT_DIR = tempDir;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("fills the template with the tender's data and returns a docx buffer", async () => {
    const templatesDir = path.join(tempDir, "ARCHIE", "templates");
    await mkdir(templatesDir, { recursive: true });
    await writeFile(
      path.join(templatesDir, "undertaking.docx"),
      buildTestDocxBuffer(
        "Dear {{clientOrganizationName}}, re: {{tenderNumber}} - {{tenderTitle}}, from {{businessName}} (GST {{businessGstNumber}}).",
      ),
    );

    const fakeTendersRepository = {
      findForDocumentGeneration: vi.fn().mockResolvedValue({
        tenderNumber: "TEN-001",
        title: "Road Widening",
        department: "PWD",
        business: {
          code: "ARCHIE",
          name: "Archie Udyog",
          address: null,
          gstNumber: "27AAAAA0000A1Z5",
          panNumber: null,
        },
        client: { name: "Acme Corp", address: null },
      }),
    };

    const { generateUndertaking } = await import("../document-generation.service.js");
    const result = await generateUndertaking(fakeTendersRepository, "tender-1", "business-1");

    const resultZip = new PizZip(result.buffer);
    const documentXml = resultZip.file("word/document.xml")!.asText();
    expect(documentXml).toContain("Dear Acme Corp, re: TEN-001 - Road Widening, from Archie Udyog (GST 27AAAAA0000A1Z5).");
    expect(fakeTendersRepository.findForDocumentGeneration).toHaveBeenCalledWith("tender-1", "business-1");
    expect(result.filename).toMatch(/^Undertaking-TEN-001-\d{2}-\d{2}-\d{4}\.docx$/);
  });

  it("throws NotFoundError when the tender doesn't exist for that business", async () => {
    const fakeTendersRepository = {
      findForDocumentGeneration: vi.fn().mockResolvedValue(null),
    };
    const { generateUndertaking } = await import("../document-generation.service.js");

    await expect(generateUndertaking(fakeTendersRepository, "missing", "business-1")).rejects.toThrow(
      "Tender not found",
    );
  });

  it("throws a clear error when the template file is missing", async () => {
    const fakeTendersRepository = {
      findForDocumentGeneration: vi.fn().mockResolvedValue({
        tenderNumber: "TEN-001",
        title: "Road Widening",
        department: "PWD",
        business: { code: "ARCHIE", name: "Archie Udyog", address: null, gstNumber: null, panNumber: null },
        client: { name: "Acme Corp", address: null },
      }),
    };
    const { generateUndertaking } = await import("../document-generation.service.js");

    await expect(generateUndertaking(fakeTendersRepository, "tender-1", "business-1")).rejects.toThrow(
      /template not found/i,
    );
  });
});
