import { readFile } from "node:fs/promises";

import type { BoqItemDto } from "@bmp/types";
import PDFDocument from "pdfkit";

import { NotFoundError } from "../../core/errors/HttpErrors.js";
import { round2 } from "../../shared/utils/math.js";
import { buildBoqItemTree } from "../boq/boq.mapper.js";
import type { IBoqRepository } from "../boq/boq.repository.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import { fillDocxTemplate, formatDate, getTemplateStatus } from "./document-generation.service.js";

export type QuotationFormat = "docx" | "csv" | "pdf";

export interface QuotationRow {
  itemCode: string;
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
  return flattenBoqItems(items).map(({ node, depth }) => ({
    itemCode: node.itemCode ?? "",
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

export function buildQuotationCsv(rows: QuotationRow[], totalAmount: number): Buffer {
  const header = ["Item Code", "Description", "Unit", "Quantity", "Rate", "Amount"];
  const dataLines = rows.map((r) => [r.itemCode, r.description, r.unit, r.quantity, r.rate, r.amount]);
  const totalLine = ["", "", "", "", "Total", formatNumber(totalAmount)];
  const lines = [header, ...dataLines, totalLine].map((cols) => cols.map(escapeCsvField).join(","));
  return Buffer.from(lines.join("\r\n"), "utf-8");
}

// Fixed per-column widths sized for a description-heavy table (item descriptions in this app
// commonly run 140-180 chars — see rfq/quote-sheet.ts), with wrapped row heights computed via
// doc.heightOfString and page-break handling — same pattern as rfq/rfq-document.ts#buildRfrPdf.
// Deliberately not the reports module's exportTableToPdf (reports/reports.export.ts), which uses
// equal-width columns and a flat row height with no wrapping — wrong fit for this data.
const QUOTATION_COLUMN_HEADERS = ["Item Code", "Description", "Unit", "Qty", "Rate", "Amount"];
const QUOTATION_COLUMN_WIDTHS = [50, 220, 40, 45, 60, 70];

export function buildQuotationPdf(
  rows: QuotationRow[],
  totalAmount: number,
  header: { businessName: string; tenderNumber: string; tenderTitle: string; clientName: string },
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
      drawRow([row.itemCode, row.description, row.unit, row.quantity, row.rate, row.amount], false);
    }
    y += 4;
    doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
    y += 6;
    drawRow(["", "", "", "", "Total", formatNumber(totalAmount)], true);

    doc.end();
  });
}

export async function generateQuotation(
  tendersRepository: Pick<ITendersRepository, "findForDocumentGeneration">,
  boqRepository: Pick<IBoqRepository, "findCurrentBoq" | "findItemsByBoqId">,
  tenderId: string,
  businessId: string,
  format: QuotationFormat,
): Promise<GeneratedQuotation> {
  const tender = await tendersRepository.findForDocumentGeneration(tenderId, businessId);
  if (!tender) throw new NotFoundError("Tender not found");

  const boq = await boqRepository.findCurrentBoq(tenderId, businessId);
  if (!boq) throw new NotFoundError("No BOQ found for this tender");

  const items = await boqRepository.findItemsByBoqId(boq.id);
  const rows = buildQuotationRows(buildBoqItemTree(items));
  const totalAmount = round2(items.reduce((sum, item) => sum + (item.amount ?? 0), 0));
  const generatedDate = formatDate(new Date());
  const filenameBase = `Quotation-${tender.tenderNumber}-${generatedDate}`;

  let buffer: Buffer;
  if (format === "csv") {
    buffer = buildQuotationCsv(rows, totalAmount);
  } else if (format === "pdf") {
    buffer = await buildQuotationPdf(rows, totalAmount, {
      businessName: tender.business.name,
      tenderNumber: tender.tenderNumber,
      tenderTitle: tender.title,
      clientName: tender.client.name,
    });
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
