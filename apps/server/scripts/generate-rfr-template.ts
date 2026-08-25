import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import PizZip from "pizzip";

// Builds the bundled Word template docxtemplater fills at request time. Not hand-edited in
// Word — re-run this script (`pnpm --filter @bmp/server exec tsx scripts/generate-rfr-template.ts`)
// after changing the layout below, and commit the regenerated apps/server/templates/rfr.docx.

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(currentDir, "..", "templates", "rfr.docx");

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types>";

const RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

function paragraph(text: string, opts: { bold?: boolean; center?: boolean } = {}): string {
  const pPr = opts.center ? '<w:pPr><w:jc w:val="center"/></w:pPr>' : "";
  const rPr = opts.bold ? "<w:rPr><w:b/></w:rPr>" : "";
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function cell(text: string, opts: { bold?: boolean } = {}): string {
  const rPr = opts.bold ? "<w:rPr><w:b/></w:rPr>" : "";
  return `<w:tc><w:p><w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
}

const HEADERS = ["Description", "Unit", "Qty", "Instructions", "Rate", "Make", "Model", "Regret (Y/N)", "Remarks"];
const headerRow = `<w:tr>${HEADERS.map((h) => cell(h, { bold: true })).join("")}</w:tr>`;

// The loop row: {{#items}} opens in the first cell, {{/items}} closes in the last cell of
// THIS SAME row. docxtemplater repeats the whole <w:tr> once per array element and resolves
// {{description}}/{{unit}}/{{quantity}}/{{instructions}} against each item's own fields.
// Rate/Make/Model/Regret/Remarks are left blank for the vendor to fill in by hand.
const loopRowCells = [
  cell("{{#items}}{{description}}"),
  cell("{{unit}}"),
  cell("{{quantity}}"),
  cell("{{instructions}}"),
  cell(""),
  cell(""),
  cell(""),
  cell(""),
  cell("{{/items}}"),
];
const loopRow = `<w:tr>${loopRowCells.join("")}</w:tr>`;

const tableBorders =
  "<w:tblBorders>" +
  '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  "</w:tblBorders>";
const tblGrid = `<w:tblGrid>${HEADERS.map(() => "<w:gridCol/>").join("")}</w:tblGrid>`;
const table = `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${tableBorders}</w:tblPr>${tblGrid}${headerRow}${loopRow}</w:tbl>`;

const DOCUMENT_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  "<w:body>" +
  paragraph("{{businessName}}", { bold: true, center: true }) +
  paragraph("{{businessAddress}}", { center: true }) +
  paragraph("GSTIN: {{businessGstNumber}}", { center: true }) +
  "<w:p/>" +
  paragraph("Request for Rates: {{rfqTitle}}", { bold: true }) +
  paragraph("Tender Ref: {{tenderNumber}}     Due Date: {{dueDate}}") +
  paragraph("Instructions: {{instructions}}") +
  "<w:p/>" +
  table +
  "<w:p/>" +
  "</w:body>" +
  "</w:document>";

async function main() {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", DOCUMENT_XML);
  const buffer = zip.generate({ type: "nodebuffer" });
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, buffer);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
