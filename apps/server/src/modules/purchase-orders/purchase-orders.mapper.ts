import type {
  GoodsReceiptDto,
  GoodsReceiptItemDto,
  PurchaseOrderDto,
  PurchaseOrderItemDto,
  PurchaseOrderListItemDto,
  VendorRatingSummaryDto,
} from "@bmp/types";

import { round2 } from "../../shared/utils/math.js";
import type { ExportableTable } from "../../shared/utils/table-export.js";

import type { PurchaseOrderDetail, PurchaseOrderListItem } from "./purchase-orders.repository.js";

function toItemDto(item: PurchaseOrderDetail["items"][number]): PurchaseOrderItemDto {
  return {
    id: item.id,
    description: item.description,
    unit: item.unit,
    quantity: item.quantity,
    rate: item.rate,
    amount: item.amount,
    receivedQuantity: item.receivedQuantity,
    sortOrder: item.sortOrder,
  };
}

function toGoodsReceiptItemDto(item: PurchaseOrderDetail["goodsReceipts"][number]["items"][number]): GoodsReceiptItemDto {
  return {
    id: item.id,
    purchaseOrderItemId: item.purchaseOrderItemId,
    quantityReceived: item.quantityReceived,
    remarks: item.remarks,
  };
}

function toGoodsReceiptDto(entity: PurchaseOrderDetail["goodsReceipts"][number]): GoodsReceiptDto {
  return {
    id: entity.id,
    receivedDate: entity.receivedDate.toISOString(),
    remarks: entity.remarks,
    receivedBy: {
      id: entity.receivedBy.id,
      firstName: entity.receivedBy.firstName,
      lastName: entity.receivedBy.lastName,
    },
    items: entity.items.map(toGoodsReceiptItemDto),
    createdAt: entity.createdAt.toISOString(),
  };
}

function toVendorRatingSummaryDto(
  entity: NonNullable<PurchaseOrderDetail["vendorRating"]>,
): VendorRatingSummaryDto {
  return {
    id: entity.id,
    rating: entity.rating,
    remarks: entity.remarks,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toPurchaseOrderListItemDto(entity: PurchaseOrderListItem): PurchaseOrderListItemDto {
  return {
    id: entity.id,
    poNumber: entity.poNumber,
    vendor: { id: entity.vendor.id, name: entity.vendor.name },
    tenderId: entity.tenderId,
    status: entity.status,
    totalAmount: round2(entity.items.reduce((sum, item) => sum + item.amount, 0)),
    expectedDeliveryDate: entity.expectedDeliveryDate ? entity.expectedDeliveryDate.toISOString() : null,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toPurchaseOrderDto(entity: PurchaseOrderDetail): PurchaseOrderDto {
  return {
    id: entity.id,
    poNumber: entity.poNumber,
    vendor: { id: entity.vendor.id, name: entity.vendor.name },
    tenderId: entity.tenderId,
    status: entity.status,
    totalAmount: round2(entity.items.reduce((sum, item) => sum + item.amount, 0)),
    expectedDeliveryDate: entity.expectedDeliveryDate ? entity.expectedDeliveryDate.toISOString() : null,
    sourceRfqId: entity.sourceRfqId,
    notes: entity.notes,
    items: entity.items.map(toItemDto),
    goodsReceipts: entity.goodsReceipts.map(toGoodsReceiptDto),
    vendorRating: entity.vendorRating ? toVendorRatingSummaryDto(entity.vendorRating) : null,
    createdBy: {
      id: entity.createdBy.id,
      firstName: entity.createdBy.firstName,
      lastName: entity.createdBy.lastName,
    },
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

// Keep this in exact sync with
// apps/web/src/components/purchase-orders/purchase-order-column-registry.tsx's
// PURCHASE_ORDER_COLUMNS keys — every column a user can show via ColumnPicker must be
// exportable, or showing it and then exporting silently drops it from the file.
const PURCHASE_ORDER_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: "poNumber", header: "PO Number" },
  { key: "vendorName", header: "Vendor" },
  { key: "status", header: "Status" },
  { key: "totalAmount", header: "Total" },
  { key: "expectedDeliveryDate", header: "Expected Delivery" },
];

function purchaseOrderExportRow(po: PurchaseOrderListItemDto): Record<string, string | number> {
  return {
    poNumber: po.poNumber,
    vendorName: po.vendor.name,
    status: po.status,
    totalAmount: po.totalAmount,
    expectedDeliveryDate: po.expectedDeliveryDate ? po.expectedDeliveryDate.slice(0, 10) : "",
  };
}

export function buildPurchaseOrderExportTable(
  purchaseOrders: PurchaseOrderListItemDto[],
  columnKeys: string[],
): ExportableTable {
  const columnsByKey = new Map(PURCHASE_ORDER_EXPORT_COLUMNS.map((column) => [column.key, column]));
  const columns = columnKeys
    .map((key) => columnsByKey.get(key))
    .filter((column): column is { key: string; header: string } => Boolean(column));
  const rows = purchaseOrders.map((po) => {
    const fullRow = purchaseOrderExportRow(po);
    const row: Record<string, string | number> = {};
    for (const column of columns) row[column.key] = fullRow[column.key] ?? "";
    return row;
  });
  return { title: "Purchase Orders", columns, rows };
}

export const PURCHASE_ORDER_EXPORT_COLUMN_KEYS = PURCHASE_ORDER_EXPORT_COLUMNS.map((column) => column.key);
