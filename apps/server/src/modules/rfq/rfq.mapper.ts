import type {
  ItemPriceHistoryDto,
  RfqDto,
  RfqItemDto,
  RfqListItemDto,
  RfqQuoteDto,
  RfqVendorInviteDto,
} from "@bmp/types";

import type { ExportableTable } from "../../shared/utils/table-export.js";

import type { ItemPriceRow, RfqDetail, RfqItemDetail, RfqListItem } from "./rfq.repository.js";

function toQuoteDto(quote: RfqItemDetail["quotes"][number]): RfqQuoteDto {
  return {
    id: quote.id,
    vendorId: quote.vendorId,
    rate: quote.rate,
    regretted: quote.regretted,
    make: quote.make,
    model: quote.model,
    quotedAt: quote.quotedAt.toISOString(),
    remarks: quote.remarks,
    updatedAt: quote.updatedAt.toISOString(),
    isSelected: quote.isSelected,
  };
}

function toItemDto(item: RfqItemDetail): RfqItemDto {
  return {
    id: item.id,
    boqItemId: item.boqItemId,
    description: item.description,
    unit: item.unit,
    quantity: item.quantity,
    instructions: item.instructions,
    sortOrder: item.sortOrder,
    quotes: item.quotes.map(toQuoteDto),
  };
}

function toVendorInviteDto(invite: RfqDetail["vendorInvites"][number]): RfqVendorInviteDto {
  return {
    id: invite.id,
    vendor: { id: invite.vendor.id, name: invite.vendor.name },
    status: invite.status,
    createdAt: invite.createdAt.toISOString(),
  };
}

export function toRfqListItemDto(entity: RfqListItem): RfqListItemDto {
  return {
    id: entity.id,
    title: entity.title,
    tenderId: entity.tenderId,
    status: entity.status,
    dueDate: entity.dueDate ? entity.dueDate.toISOString() : null,
    itemCount: entity._count.items,
    vendorCount: entity._count.vendorInvites,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toItemPriceHistoryDto(
  row: ItemPriceRow,
  category: string | null,
): ItemPriceHistoryDto {
  return {
    quoteId: row.id,
    description: row.rfqItem.description,
    category,
    unit: row.rfqItem.unit,
    quantity: row.rfqItem.quantity,
    vendorId: row.vendor.id,
    vendorName: row.vendor.name,
    // Non-null: the repo filters out regretted/no-price rows.
    rate: row.rate!,
    make: row.make,
    model: row.model,
    quotedAt: row.quotedAt.toISOString(),
    remarks: row.remarks,
    rfqId: row.rfqItem.rfq.id,
    rfqTitle: row.rfqItem.rfq.title,
    tenderId: row.rfqItem.rfq.tender?.id ?? null,
    tenderName: row.rfqItem.rfq.tender?.title ?? null,
  };
}

export function toRfqDto(entity: RfqDetail): RfqDto {
  return {
    id: entity.id,
    title: entity.title,
    tenderId: entity.tenderId,
    status: entity.status,
    dueDate: entity.dueDate ? entity.dueDate.toISOString() : null,
    instructions: entity.instructions,
    itemCount: entity.items.length,
    vendorCount: entity.vendorInvites.length,
    items: entity.items.map(toItemDto),
    vendorInvites: entity.vendorInvites.map(toVendorInviteDto),
    createdBy: {
      id: entity.createdBy.id,
      firstName: entity.createdBy.firstName,
      lastName: entity.createdBy.lastName,
    },
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

// Keep this in exact sync with apps/web/src/components/rfqs/rfq-column-registry.tsx's
// RFQ_COLUMNS keys — every column a user can show via ColumnPicker must be exportable, or
// showing it and then exporting silently drops it from the file.
const RFQ_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: "title", header: "Title" },
  { key: "status", header: "Status" },
  { key: "dueDate", header: "Due Date" },
  { key: "itemCount", header: "Items" },
  { key: "vendorCount", header: "Vendors Invited" },
];

function rfqExportRow(rfq: RfqListItemDto): Record<string, string | number> {
  return {
    title: rfq.title,
    status: rfq.status,
    dueDate: rfq.dueDate ? rfq.dueDate.slice(0, 10) : "",
    itemCount: rfq.itemCount,
    vendorCount: rfq.vendorCount,
  };
}

export function buildRfqExportTable(rfqs: RfqListItemDto[], columnKeys: string[]): ExportableTable {
  const columnsByKey = new Map(RFQ_EXPORT_COLUMNS.map((column) => [column.key, column]));
  const columns = columnKeys
    .map((key) => columnsByKey.get(key))
    .filter((column): column is { key: string; header: string } => Boolean(column));
  const rows = rfqs.map((rfq) => {
    const fullRow = rfqExportRow(rfq);
    const row: Record<string, string | number> = {};
    for (const column of columns) row[column.key] = fullRow[column.key] ?? "";
    return row;
  });
  return { title: "RFQs", columns, rows };
}

export const RFQ_EXPORT_COLUMN_KEYS = RFQ_EXPORT_COLUMNS.map((column) => column.key);
