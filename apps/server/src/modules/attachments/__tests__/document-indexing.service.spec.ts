import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { describe, expect, it } from "vitest";

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

function buildTestPdfBuffer(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 712 Td (${text}) Tj ET`;
  const objs = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objs) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

describe("extractText", () => {
  it("extracts text from a PDF buffer", async () => {
    const buffer = buildTestPdfBuffer("Notice Inviting Tender for XLPE Cable Supply");
    const result = await extractText(buffer, "application/pdf");
    expect(result).toContain("Notice Inviting Tender for XLPE Cable Supply");
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
