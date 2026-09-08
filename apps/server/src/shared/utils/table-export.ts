import ExcelJS from "exceljs";

export interface ExportableTable {
  title: string;
  columns: { key: string; header: string }[];
  rows: Record<string, string | number>[];
}

export async function exportTableToXlsx(table: ExportableTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(table.title.slice(0, 31));
  sheet.columns = table.columns.map((column) => ({ header: column.header, key: column.key, width: 22 }));
  sheet.addRows(table.rows);
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function escapeCsvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function exportTableToCsv(table: ExportableTable): Buffer {
  const header = table.columns.map((column) => column.header);
  const dataLines = table.rows.map((row) => table.columns.map((column) => String(row[column.key] ?? "")));
  const lines = [header, ...dataLines].map((cols) => cols.map(escapeCsvField).join(","));
  return Buffer.from(lines.join("\r\n"), "utf-8");
}
