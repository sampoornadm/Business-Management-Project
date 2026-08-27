import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { describe, expect, it, vi } from "vitest";

const { pdfParseMock } = vi.hoisted(() => ({ pdfParseMock: vi.fn() }));
vi.mock("pdf-parse", () => ({ default: pdfParseMock }));

import { extractText } from "../document-indexing.service.js";

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

describe("extractText", () => {
  it("extracts text from a PDF buffer", async () => {
    pdfParseMock.mockResolvedValue({ text: "Notice Inviting Tender for XLPE Cable Supply" });
    const result = await extractText(Buffer.from("fake pdf bytes"), "application/pdf");
    expect(result).toBe("Notice Inviting Tender for XLPE Cable Supply");
  });

  it("returns null when pdf-parse finds no extractable text", async () => {
    pdfParseMock.mockResolvedValue({ text: "   " });
    const result = await extractText(Buffer.from("fake pdf bytes"), "application/pdf");
    expect(result).toBeNull();
  });

  it("returns null when pdf-parse throws", async () => {
    pdfParseMock.mockRejectedValue(new Error("corrupt PDF"));
    const result = await extractText(Buffer.from("fake pdf bytes"), "application/pdf");
    expect(result).toBeNull();
  });

  it("extracts text from a DOCX buffer", async () => {
    const buffer = buildTestDocxBuffer("Undertaking for tender TND-2026-001");
    const result = await extractText(
      buffer,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(result).toContain("Undertaking for tender TND-2026-001");
  });

  it("returns null for a mime type with no extractor (e.g. an image)", async () => {
    const result = await extractText(Buffer.from("fake image bytes"), "image/png");
    expect(result).toBeNull();
  });
});
