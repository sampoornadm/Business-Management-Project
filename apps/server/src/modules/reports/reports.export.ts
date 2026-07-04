import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

import type { ExportableTable } from "./reports.service.js";

export async function exportTableToXlsx(table: ExportableTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(table.title.slice(0, 31));
  sheet.columns = table.columns.map((column) => ({ header: column.header, key: column.key, width: 22 }));
  sheet.addRows(table.rows);
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function exportTableToPdf(table: ExportableTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(table.title, { align: "left" });
    doc.moveDown();

    const columnWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / table.columns.length;
    const startX = doc.page.margins.left;
    let y = doc.y;

    doc.fontSize(10).font("Helvetica-Bold");
    table.columns.forEach((column, index) => {
      doc.text(column.header, startX + index * columnWidth, y, { width: columnWidth });
    });
    y += 20;
    doc.moveTo(startX, y).lineTo(doc.page.width - doc.page.margins.right, y).stroke();
    y += 6;

    doc.font("Helvetica");
    for (const row of table.rows) {
      if (y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      table.columns.forEach((column, index) => {
        doc.text(String(row[column.key] ?? ""), startX + index * columnWidth, y, { width: columnWidth });
      });
      y += 18;
    }

    doc.end();
  });
}
