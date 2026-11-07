import { readFile } from "node:fs/promises";

import type { BoqItemDto } from "@bmp/types";
import PDFDocument from "pdfkit";
import PizZip from "pizzip";

import { NotFoundError } from "../../core/errors/HttpErrors.js";
import { round2 } from "../../shared/utils/math.js";
import { buildBoqItemTree } from "../boq/boq.mapper.js";
import type { IBoqRepository } from "../boq/boq.repository.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import { fillDocxTemplate, formatDate, getTemplateStatus } from "./document-generation.service.js";

export type QuotationFormat = "docx" | "csv" | "pdf";

export interface QuotationRow {
  slNo: string;
  description: string;
  unit: string;
  quantity: string;
  rate: string;
  amount: string;
}

export interface GeneratedQuotation {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  tenderId: string;
  tenderNumber: string;
  tenderTitle: string;
  businessCode: string;
}

const QUOTATION_MIME_TYPES: Record<QuotationFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv",
  pdf: "application/pdf",
};

function flattenBoqItems(nodes: BoqItemDto[], depth = 0): Array<{ node: BoqItemDto; depth: number }> {
  const rows: Array<{ node: BoqItemDto; depth: number }> = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    rows.push(...flattenBoqItems(node.children, depth + 1));
  }
  return rows;
}

function formatNumber(value: number | null): string {
  return value == null ? "" : value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** BOQ tree (as `buildBoqItemTree` produces) -> a flat, print-ordered row list. */
export function buildQuotationRows(items: BoqItemDto[]): QuotationRow[] {
  return flattenBoqItems(items).map(({ node, depth }, index) => ({
    slNo: String(index + 1),
    description: `${"  ".repeat(depth)}${node.description}`,
    unit: node.unit ?? "",
    quantity: formatNumber(node.quantity),
    rate: formatNumber(node.rate),
    amount: formatNumber(node.amount),
  }));
}

function escapeCsvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildQuotationCsv(rows: QuotationRow[], totalAmount: number, pinnedNotes: string[] = []): Buffer {
  const header = ["Sl. No.", "Description", "Unit", "Quantity", "Rate", "Amount"];
  const dataLines = rows.map((r) => [r.slNo, r.description, r.unit, r.quantity, r.rate, r.amount]);
  const totalLine = ["", "", "", "", "Total", formatNumber(totalAmount)];
  const blank = ["", "", "", "", "", ""];
  // Notes have no natural column of their own, so they're placed under Description (the one
  // free-text column) — keeps them visually aligned with the item table instead of stranded
  // in column A when opened in a spreadsheet.
  const noteLines =
    pinnedNotes.length > 0
      ? [blank, ["", "Notes", "", "", "", ""], ...pinnedNotes.map((note) => ["", `• ${note}`, "", "", "", ""])]
      : [];
  const lines = [header, ...dataLines, totalLine, ...noteLines].map((cols) => cols.map(escapeCsvField).join(","));
  // Prepend a UTF-8 BOM: without it, Excel opens the file assuming the system codepage
  // (e.g. Windows-1252) and renders non-ASCII bytes like "Ø" (diameter symbol, common in
  // cable/pipe descriptions) as mojibake instead of the intended glyph.
  return Buffer.concat([Buffer.from("﻿", "utf-8"), Buffer.from(lines.join("\r\n"), "utf-8")]);
}

/** Bulleted pinned-notes block under a PDF table, page-breaking as needed. */
function drawPinnedNotes(
  doc: PDFKit.PDFDocument,
  pinnedNotes: string[],
  heading: string,
  x: number,
  startY: number,
  width: number,
): void {
  if (pinnedNotes.length === 0) return;
  const bottom = doc.page.height - doc.page.margins.bottom;
  let y = startY;
  if (y + 20 > bottom) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  doc.font("Helvetica-Bold").fontSize(10).text(heading, x, y);
  y += doc.heightOfString(heading, { width }) + 4;
  doc.font("Helvetica").fontSize(9);
  for (const note of pinnedNotes) {
    const bullet = `• ${note}`;
    const noteHeight = doc.heightOfString(bullet, { width }) + 3;
    if (y + noteHeight > bottom) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.text(bullet, x, y, { width });
    y += noteHeight;
  }
}

// Fixed per-column widths sized for a description-heavy table (item descriptions in this app
// commonly run 140-180 chars — see rfq/quote-sheet.ts), with wrapped row heights computed via
// doc.heightOfString and page-break handling — same pattern as rfq/rfq-document.ts#buildRfrPdf.
// Deliberately not the reports module's exportTableToPdf (reports/reports.export.ts), which uses
// equal-width columns and a flat row height with no wrapping — wrong fit for this data.
const QUOTATION_COLUMN_HEADERS = ["Sl. No.", "Description", "Unit", "Qty", "Rate", "Amount"];
const QUOTATION_COLUMN_WIDTHS = [30, 250, 40, 45, 60, 70];

export function buildQuotationPdf(
  rows: QuotationRow[],
  totalAmount: number,
  header: { businessName: string; tenderNumber: string; tenderTitle: string; clientName: string },
  pinnedNotes: string[] = [],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const startX = doc.page.margins.left;

    doc.fontSize(14).font("Helvetica-Bold").text(header.businessName, { align: "center" });
    doc.moveDown();
    doc.fontSize(12).font("Helvetica-Bold").text(`Quotation: ${header.tenderTitle}`);
    doc.fontSize(9).font("Helvetica").text(`Tender Ref: ${header.tenderNumber}   Client: ${header.clientName}`);
    doc.moveDown();

    let y = doc.y;
    function columnX(index: number): number {
      return startX + QUOTATION_COLUMN_WIDTHS.slice(0, index).reduce((sum, w) => sum + w, 0);
    }
    function drawRow(values: string[], bold: boolean) {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      const rowHeight = Math.max(
        16,
        ...values.map((value, index) => doc.heightOfString(value, { width: QUOTATION_COLUMN_WIDTHS[index]! }) + 4),
      );
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      values.forEach((value, index) => {
        doc.text(value, columnX(index), y, { width: QUOTATION_COLUMN_WIDTHS[index]! });
      });
      y += rowHeight;
    }

    drawRow(QUOTATION_COLUMN_HEADERS, true);
    const tableWidth = QUOTATION_COLUMN_WIDTHS.reduce((sum, w) => sum + w, 0);
    doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
    y += 4;

    for (const row of rows) {
      drawRow([row.slNo, row.description, row.unit, row.quantity, row.rate, row.amount], false);
    }
    y += 4;
    doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
    y += 6;
    drawRow(["", "", "", "", "Total", formatNumber(totalAmount)], true);

    drawPinnedNotes(doc, pinnedNotes, "Important Notes", startX, y + 10, tableWidth);

    doc.end();
  });
}

type DocTendersRepository = Pick<ITendersRepository, "findForDocumentGeneration">;
type DocBoqRepository = Pick<IBoqRepository, "findCurrentBoq" | "findItemsByBoqId">;

async function loadTenderBoq(
  tendersRepository: DocTendersRepository,
  boqRepository: DocBoqRepository,
  tenderId: string,
  businessId: string,
) {
  const tender = await tendersRepository.findForDocumentGeneration(tenderId, businessId);
  if (!tender) throw new NotFoundError("Tender not found");

  const boq = await boqRepository.findCurrentBoq(tenderId, businessId);
  if (!boq) throw new NotFoundError("No BOQ found for this tender");

  const items = await boqRepository.findItemsByBoqId(boq.id);
  return { tender, items, rows: buildQuotationRows(buildBoqItemTree(items)) };
}

export async function generateQuotation(
  tendersRepository: DocTendersRepository,
  boqRepository: DocBoqRepository,
  tenderId: string,
  businessId: string,
  format: QuotationFormat,
): Promise<GeneratedQuotation> {
  const { tender, items, rows } = await loadTenderBoq(tendersRepository, boqRepository, tenderId, businessId);
  const totalAmount = round2(items.reduce((sum, item) => sum + (item.amount ?? 0), 0));
  const generatedDate = formatDate(new Date());
  const filenameBase = `Quotation-${tender.tenderNumber}-${generatedDate}`;
  const pinnedNotes = tender.pinnedNotes.map((note) => note.lineText);

  let buffer: Buffer;
  if (format === "csv") {
    buffer = buildQuotationCsv(rows, totalAmount, pinnedNotes);
  } else if (format === "pdf") {
    buffer = await buildQuotationPdf(
      rows,
      totalAmount,
      {
        businessName: tender.business.name,
        tenderNumber: tender.tenderNumber,
        tenderTitle: tender.title,
        clientName: tender.client.name,
      },
      pinnedNotes,
    );
  } else {
    const status = await getTemplateStatus(tender.business.code, "quotation");
    if (!status.exists) {
      throw new NotFoundError(
        `Quotation template not found for ${tender.business.code}. Place it at ${status.path}`,
      );
    }
    const templateBuffer = await readFile(status.path);
    buffer = fillDocxTemplate(templateBuffer, {
      tenderNumber: tender.tenderNumber,
      tenderTitle: tender.title,
      businessName: tender.business.name,
      clientOrganizationName: tender.client.name,
      generatedDate,
      totalAmount: formatNumber(totalAmount),
      items: rows,
      // Same {{#hasPinnedNotes}}{{#pinnedNotes}}{{.}}{{/pinnedNotes}}{{/hasPinnedNotes}}
      // convention as the RFR template (rfq-document.ts#buildRfrDocx) — add that block at the
      // end of quotation.docx to render these; docxtemplater can't inject a section a template
      // doesn't already reference.
      pinnedNotes,
      hasPinnedNotes: pinnedNotes.length > 0 ? [{}] : [],
    });
  }

  return {
    buffer,
    filename: `${filenameBase}.${format}`,
    mimeType: QUOTATION_MIME_TYPES[format],
    tenderId,
    tenderNumber: tender.tenderNumber,
    tenderTitle: tender.title,
    businessCode: tender.business.code,
  };
}

// Tender Sheet: a bare, ink-light item list handed to vendors to fill in rates by hand (and kept
// for our own records). No letterhead, no amounts, no total — just RFx no., deadline, items, notes.
const TENDER_SHEET_COLUMN_HEADERS = ["Sl. No.", "Item Description", "Qty", "UoM", "Rate"];
// Sums to 535 = A4 width (595) minus 2 x 30pt margins; the Rate cell is left wide for handwriting.
const TENDER_SHEET_COLUMN_WIDTHS = [32, 343, 50, 40, 70];
const TENDER_SHEET_COLUMN_ALIGN = ["center", "left", "right", "center", "left"] as const;
const TENDER_SHEET_CELL_PADDING = 3;

/** Row values in TENDER_SHEET_COLUMN_HEADERS order; Rate is always blank for the vendor. */
function tenderSheetCells(row: QuotationRow): string[] {
  return [row.slNo, row.description, row.quantity, row.unit, ""];
}

export function buildTenderSheetPdf(
  rows: QuotationRow[],
  header: { rfxNumber: string; submissionDeadline: string },
  pinnedNotes: string[] = [],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const startX = doc.page.margins.left;
    const bottom = doc.page.height - doc.page.margins.bottom;
    const tableWidth = TENDER_SHEET_COLUMN_WIDTHS.reduce((sum, w) => sum + w, 0);
    let y = doc.page.margins.top;

    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(`RFx No: ${header.rfxNumber}`, startX, y, { width: tableWidth });
    doc.text(`Submission Deadline: ${header.submissionDeadline}`, startX, y, { width: tableWidth, align: "right" });
    y = doc.y + 8;

    doc.lineWidth(0.5);
    function drawRow(values: string[], isHeader: boolean) {
      doc.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      const pad = TENDER_SHEET_CELL_PADDING;
      const rowHeight = Math.max(
        16,
        ...values.map(
          (value, i) => doc.heightOfString(value, { width: TENDER_SHEET_COLUMN_WIDTHS[i]! - 2 * pad }) + 2 * pad,
        ),
      );
      if (y + rowHeight > bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        // Repeat the header on every printed page so loose sheets still read on their own.
        if (!isHeader) drawRow(TENDER_SHEET_COLUMN_HEADERS, true);
        doc.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      }
      let x = startX;
      values.forEach((value, i) => {
        const width = TENDER_SHEET_COLUMN_WIDTHS[i]!;
        doc.rect(x, y, width, rowHeight).stroke();
        doc.text(value, x + pad, y + pad, { width: width - 2 * pad, align: TENDER_SHEET_COLUMN_ALIGN[i] });
        x += width;
      });
      y += rowHeight;
    }

    drawRow(TENDER_SHEET_COLUMN_HEADERS, true);
    for (const row of rows) drawRow(tenderSheetCells(row), false);

    drawPinnedNotes(doc, pinnedNotes, "Terms & Notes", startX, y + 12, tableWidth);

    doc.end();
  });
}

function formatDateTime(date: Date): string {
  // ponytail: fixed IST, same default as ASSISTANT_TIMEZONE; read env if a non-IST business appears.
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export type TenderSheetFormat = "pdf" | "docx";

export async function generateTenderSheet(
  tendersRepository: DocTendersRepository,
  boqRepository: DocBoqRepository,
  tenderId: string,
  businessId: string,
  format: TenderSheetFormat,
): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  const { tender, rows } = await loadTenderBoq(tendersRepository, boqRepository, tenderId, businessId);
  const header = {
    rfxNumber: tender.tenderNumber,
    submissionDeadline: tender.submissionDate ? formatDateTime(tender.submissionDate) : "—",
  };
  const pinnedNotes = tender.pinnedNotes.map((note) => note.lineText);
  const buffer =
    format === "docx"
      ? buildTenderSheetDocx(rows, header, pinnedNotes)
      : await buildTenderSheetPdf(rows, header, pinnedNotes);
  return {
    buffer,
    filename: `Tender-Sheet-${tender.tenderNumber}-${formatDate(new Date())}.${format}`,
    mimeType: QUOTATION_MIME_TYPES[format],
  };
}

// The Word version is written straight to OOXML with PizZip rather than filled from a template:
// its layout is fixed in code (same columns/widths as the PDF), there's no letterhead to keep in
// sync, and building the rows here sidesteps docxtemplater's loop quirks entirely.
const TWIPS_PER_POINT = 20;
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function xmlText(value: string): string {
  return (
    value
      // XML 1.0 forbids most control chars (pdftotext leaves form feeds in extracted text);
      // one of them in a description would make Word refuse to open the file.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
  );
}

function docxRun(text: string, rPr = ""): string {
  const body = text
    .split(/\r?\n/)
    .map((line) => `<w:t xml:space="preserve">${xmlText(line)}</w:t>`)
    .join("<w:br/>");
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}${body}</w:r>`;
}

export function buildTenderSheetDocx(
  rows: QuotationRow[],
  header: { rfxNumber: string; submissionDeadline: string },
  pinnedNotes: string[] = [],
): Buffer {
  const widths = TENDER_SHEET_COLUMN_WIDTHS.map((w) => w * TWIPS_PER_POINT);
  const tableWidth = widths.reduce((sum, w) => sum + w, 0);
  const tableRow = (values: string[], isHeader: boolean) =>
    // cantSplit keeps an item on one page; tblHeader repeats the header row on every printed page.
    `<w:tr><w:trPr><w:cantSplit/>${isHeader ? "<w:tblHeader/>" : ""}</w:trPr>${values
      .map(
        (value, i) =>
          `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/></w:tcPr>` +
          `<w:p><w:pPr><w:jc w:val="${TENDER_SHEET_COLUMN_ALIGN[i]}"/></w:pPr>${docxRun(value, isHeader ? "<w:b/>" : "")}</w:p></w:tc>`,
      )
      .join("")}</w:tr>`;
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`;

  const body =
    `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="${tableWidth}"/></w:tabs><w:spacing w:after="160"/></w:pPr>` +
    docxRun(`RFx No: ${header.rfxNumber}`, '<w:b/><w:sz w:val="20"/>') +
    "<w:r><w:tab/></w:r>" +
    docxRun(`Submission Deadline: ${header.submissionDeadline}`, '<w:b/><w:sz w:val="20"/>') +
    "</w:p>" +
    `<w:tbl><w:tblPr><w:tblW w:w="${tableWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>` +
    '<w:tblCellMar><w:left w:w="57" w:type="dxa"/><w:right w:w="57" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` +
    tableRow(TENDER_SHEET_COLUMN_HEADERS, true) +
    rows.map((row) => tableRow(tenderSheetCells(row), false)).join("") +
    "</w:tbl><w:p/>" +
    (pinnedNotes.length > 0
      ? `<w:p><w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr>${docxRun("Terms & Notes", '<w:b/><w:sz w:val="20"/>')}</w:p>` +
        pinnedNotes
          .map((note) => `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr>${docxRun(`• ${note}`, '<w:sz w:val="18"/>')}</w:p>`)
          .join("")
      : "") +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="600" w:right="600" w:bottom="600" w:left="600" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr>';

  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
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
    "word/_rels/document.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>",
  );
  // Document-wide defaults: Arial 8pt, no paragraph spacing — keeps the table as dense as the PDF.
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W_NS}"><w:docDefaults>` +
      '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      "</w:docDefaults></w:styles>",
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generate({ type: "nodebuffer" });
}
