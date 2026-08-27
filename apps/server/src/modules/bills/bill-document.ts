import PDFDocument from "pdfkit";

import { round2 } from "../../shared/utils/math.js";
import { buildAddressLine } from "../rfq/rfq-document.js";

export interface BillDocumentItem {
  description: string;
  unit: string | null;
  quantity: number;
  rate: number;
}

export interface BillDocumentData {
  businessName: string;
  businessAddress: string | null;
  businessGstNumber: string | null;
  clientName: string;
  clientAddress: string | null;
  billNumber: string;
  billDate: string;
  tenderNumber: string;
  grnNumber: string | null;
  grnDate: string | null;
  items: BillDocumentItem[];
}

const BILL_COLUMN_HEADERS = ["Description", "Unit", "Qty", "Rate", "Amount"];
const BILL_COLUMN_WIDTHS = [220, 55, 55, 80, 95];

export function buildBillPdf(data: BillDocumentData, signatureBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const startX = doc.page.margins.left;

    doc.fontSize(14).font("Helvetica-Bold").text(data.businessName, { align: "center" });
    const addressLine = buildAddressLine(data.businessAddress, data.businessGstNumber);
    if (addressLine) doc.fontSize(9).font("Helvetica").text(addressLine, { align: "center" });
    doc.moveDown();

    doc.fontSize(12).font("Helvetica-Bold").text(`Bill No. ${data.billNumber}`);
    doc
      .fontSize(9)
      .font("Helvetica")
      .text(`Date: ${data.billDate}   Against Tender: ${data.tenderNumber}`);
    if (data.grnNumber) {
      const grnLine = data.grnDate
        ? `Against GRN No. ${data.grnNumber} dated ${data.grnDate}`
        : `Against GRN No. ${data.grnNumber}`;
      doc.text(grnLine);
    }
    doc.moveDown();

    doc.fontSize(10).font("Helvetica-Bold").text("Bill To:");
    doc.fontSize(9).font("Helvetica").text(data.clientName);
    if (data.clientAddress) doc.text(data.clientAddress);
    doc.moveDown();

    let y = doc.y;
    const tableWidth = BILL_COLUMN_WIDTHS.reduce((sum, w) => sum + w, 0);
    function columnX(index: number): number {
      return startX + BILL_COLUMN_WIDTHS.slice(0, index).reduce((sum, w) => sum + w, 0);
    }

    function drawRow(values: string[], bold: boolean) {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
      const rowHeight = Math.max(
        18,
        ...values.map((value, index) => doc.heightOfString(value, { width: BILL_COLUMN_WIDTHS[index]! }) + 4),
      );
      // Reserve 100pt below the table for the total line + signature block, so a row near the
      // bottom of a page doesn't get orphaned away from them.
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 100) {
        doc.addPage();
        y = doc.page.margins.top;
        drawTableHeader();
      }
      values.forEach((value, index) => {
        doc.text(value, columnX(index), y, {
          width: BILL_COLUMN_WIDTHS[index]!,
          align: index >= 2 ? "right" : "left",
        });
      });
      y += rowHeight;
    }

    // Draws the column header row plus its underline rule. Called once before the first item
    // and again immediately after every page break, so a continuation page never shows
    // unlabeled data.
    function drawTableHeader() {
      drawRow(BILL_COLUMN_HEADERS, true);
      doc.moveTo(startX, y).lineTo(startX + tableWidth, y).stroke();
      y += 4;
    }

    drawTableHeader();

    let total = 0;
    for (const item of data.items) {
      const amount = round2(item.quantity * item.rate);
      total += amount;
      drawRow(
        [item.description, item.unit ?? "", String(item.quantity), item.rate.toFixed(2), amount.toFixed(2)],
        false,
      );
    }

    y += 8;
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(`Total: Rs. ${round2(total).toFixed(2)}`, columnX(3), y, {
        width: BILL_COLUMN_WIDTHS[3]! + BILL_COLUMN_WIDTHS[4]!,
        align: "right",
      });
    y += 40;

    const signatureWidth = 120;
    doc.image(signatureBuffer, startX + tableWidth - signatureWidth, y, { fit: [signatureWidth, 45] });
    doc
      .fontSize(9)
      .font("Helvetica")
      .text("Authorized Signatory", startX + tableWidth - signatureWidth, y + 60, {
        width: signatureWidth,
        align: "center",
      });

    doc.end();
  });
}
