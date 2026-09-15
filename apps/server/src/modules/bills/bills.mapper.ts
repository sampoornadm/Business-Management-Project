import type { BillDto, BillItemDto, BillListItemDto } from "@bmp/types";

import { round2 } from "../../shared/utils/math.js";
import type { ExportableTable } from "../../shared/utils/table-export.js";

import type { BillDetail, BillListItem } from "./bills.repository.js";

function toBillItemDto(item: BillDetail["items"][number]): BillItemDto {
  return {
    id: item.id,
    boqItemId: item.boqItemId,
    description: item.description,
    unit: item.unit,
    quantity: item.quantity,
    rate: item.rate,
    amount: round2(item.quantity * item.rate),
    sortOrder: item.sortOrder,
  };
}

export function toBillListItemDto(entity: BillListItem): BillListItemDto {
  const total = entity.items.reduce((sum, item) => sum + round2(item.quantity * item.rate), 0);
  return {
    id: entity.id,
    billNumber: entity.billNumber,
    billDate: entity.billDate.toISOString(),
    tenderId: entity.tenderId,
    tenderTitle: entity.tender.title,
    clientName: entity.tender.client.name,
    total: round2(total),
    itemCount: entity._count.items,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toBillDto(entity: BillDetail): BillDto {
  const items = entity.items.map(toBillItemDto);
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  return {
    id: entity.id,
    billNumber: entity.billNumber,
    billDate: entity.billDate.toISOString(),
    tenderId: entity.tenderId,
    tenderTitle: entity.tender.title,
    clientName: entity.tender.client.name,
    total: round2(total),
    itemCount: items.length,
    grnNumber: entity.grnNumber,
    grnDate: entity.grnDate ? entity.grnDate.toISOString() : null,
    items,
    createdBy: {
      id: entity.createdBy.id,
      firstName: entity.createdBy.firstName,
      lastName: entity.createdBy.lastName,
    },
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

// Keep this in exact sync with apps/web/src/components/bills/bills-column-registry.tsx's
// BILL_COLUMNS keys — every column a user can show via ColumnPicker must be exportable, or
// showing it and then exporting silently drops it from the file.
const BILL_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: "billNumber", header: "Bill #" },
  { key: "tenderTitle", header: "Tender" },
  { key: "clientName", header: "Client" },
  { key: "billDate", header: "Date" },
  { key: "total", header: "Total" },
  { key: "itemCount", header: "Items" },
];

function billExportRow(bill: BillListItemDto): Record<string, string | number> {
  return {
    billNumber: bill.billNumber,
    tenderTitle: bill.tenderTitle,
    clientName: bill.clientName,
    billDate: bill.billDate.slice(0, 10),
    total: bill.total,
    itemCount: bill.itemCount,
  };
}

export function buildBillExportTable(bills: BillListItemDto[], columnKeys: string[]): ExportableTable {
  const columnsByKey = new Map(BILL_EXPORT_COLUMNS.map((column) => [column.key, column]));
  const columns = columnKeys
    .map((key) => columnsByKey.get(key))
    .filter((column): column is { key: string; header: string } => Boolean(column));
  const rows = bills.map((bill) => {
    const fullRow = billExportRow(bill);
    const row: Record<string, string | number> = {};
    for (const column of columns) row[column.key] = fullRow[column.key] ?? "";
    return row;
  });
  return { title: "Bills", columns, rows };
}

export const BILL_EXPORT_COLUMN_KEYS = BILL_EXPORT_COLUMNS.map((column) => column.key);
