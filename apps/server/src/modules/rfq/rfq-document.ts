import PDFDocument from "pdfkit";

import { formatDate } from "../document-generation/document-generation.service.js";

export interface RfqTextItem {
  description: string;
  unit: string | null;
  quantity: number;
}

export interface BuildRfqTextParams {
  items: RfqTextItem[];
  vendorContactName: string;
  tenderNumber?: string;
  senderName: string;
  senderEmail: string;
}

// Plain text only — no letterhead/PDF (that's a separate future phase). The
// user reviews and can edit this before it's actually sent; the server never
// regenerates it once quick-send is called.
export function buildRfqText({
  items,
  vendorContactName,
  tenderNumber,
  senderName,
  senderEmail,
}: BuildRfqTextParams): string {
  const itemLines = items
    .map((item, index) => `${index + 1}. ${item.description} — Qty: ${item.quantity}${item.unit ? ` ${item.unit}` : ""}`)
    .join("\n");

  const tenderRef = tenderNumber ? ` against tender ${tenderNumber}` : "";

  return [
    `Dear ${vendorContactName},`,
    "",
    `We would like to request your best quotation for the following item(s)${tenderRef}:`,
    "",
    itemLines,
    "",
    "Please share your quoted rates, delivery timeline, and validity period at your earliest convenience.",
    "",
    "Regards,",
    senderName,
    senderEmail,
  ].join("\n");
}

export interface RfrDocumentItem {
  rfqItemId: string;
  description: string;
  unit: string | null;
  quantity: number;
  instructions: string | null;
}

export interface RfrDocumentData {
  businessName: string;
  businessAddress: string | null;
  businessGstNumber: string | null;
  rfqTitle: string;
  tenderNumber: string | null;
  dueDate: string | null;
  instructions: string | null;
  items: RfrDocumentItem[];
}

export interface RfrSourceItem {
  id: string;
  description: string;
  unit: string | null;
  quantity: number;
  instructions: string | null;
}

export interface RfrSourceRfq {
  title: string;
  instructions: string | null;
  dueDate: Date | null;
  items: RfrSourceItem[];
}

export function toRfrDocumentData(
  rfq: RfrSourceRfq,
  business: { name: string; address: string | null; gstNumber: string | null },
  tenderNumber: string | null,
): RfrDocumentData {
  return {
    businessName: business.name,
    businessAddress: business.address,
    businessGstNumber: business.gstNumber,
    rfqTitle: rfq.title,
    tenderNumber,
    dueDate: rfq.dueDate ? formatDate(rfq.dueDate) : null,
    instructions: rfq.instructions,
    items: rfq.items.map((item) => ({
      rfqItemId: item.id,
      description: item.description,
      unit: item.unit,
      quantity: item.quantity,
      instructions: item.instructions,
    })),
  };
}

const RFR_COLUMN_HEADERS = [
  "Description",
  "Unit",
  "Qty",
  "Instructions",
  "Rate",
  "Make",
  "Model",
  "Regret (Y/N)",
  "Remarks",
];
const RFR_COLUMN_WIDTHS = [130, 35, 35, 75, 45, 50, 50, 35, 60];

export function buildRfrPdf(data: RfrDocumentData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const startX = doc.page.margins.left;

    doc.fontSize(14).font("Helvetica-Bold").text(data.businessName, { align: "center" });
    const addressLine = [
      data.businessAddress,
      data.businessGstNumber ? `GSTIN: ${data.businessGstNumber}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    if (addressLine) {
      doc.fontSize(9).font("Helvetica").text(addressLine, { align: "center" });
    }
    doc.moveDown();

    doc.fontSize(12).font("Helvetica-Bold").text(`Request for Rates: ${data.rfqTitle}`);
    const metaLine = [
      data.tenderNumber ? `Tender Ref: ${data.tenderNumber}` : null,
      data.dueDate ? `Due Date: ${data.dueDate}` : null,
    ]
      .filter(Boolean)
      .join("   ");
    if (metaLine) doc.fontSize(9).font("Helvetica").text(metaLine);
    if (data.instructions) doc.fontSize(9).font("Helvetica").text(`Instructions: ${data.instructions}`);
    doc.moveDown();

    let y = doc.y;
    function columnX(index: number): number {
      return startX + RFR_COLUMN_WIDTHS.slice(0, index).reduce((sum, w) => sum + w, 0);
    }

    function drawRow(values: string[], bold: boolean) {
      if (y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
      values.forEach((value, index) => {
        doc.text(value, columnX(index), y, { width: RFR_COLUMN_WIDTHS[index]! });
      });
      y += 18;
    }

    drawRow(RFR_COLUMN_HEADERS, true);
    const tableWidth = RFR_COLUMN_WIDTHS.reduce((sum, w) => sum + w, 0);
    doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
    y += 4;

    for (const item of data.items) {
      drawRow(
        [item.description, item.unit ?? "", String(item.quantity), item.instructions ?? "", "", "", "", "", ""],
        false,
      );
    }

    doc.end();
  });
}
