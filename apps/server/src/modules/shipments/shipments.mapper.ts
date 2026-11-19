import type { AttachmentDto, ShipmentDto } from "@bmp/types";

import { round2 } from "../../shared/utils/math.js";

import { shipmentStage } from "./shipments.logic.js";
import type { ShipmentWithDetails } from "./shipments.repository.js";

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export function toShipmentDto(entity: ShipmentWithDetails, amountReceived: number, documents: AttachmentDto[]): ShipmentDto {
  const items = [...entity.items]
    .sort((a, b) => a.clientPoItem.sortOrder - b.clientPoItem.sortOrder)
    .map((item) => ({
      id: item.id,
      clientPoItemId: item.clientPoItemId,
      boqItemId: item.clientPoItem.boqItemId,
      description: item.clientPoItem.description,
      unit: item.clientPoItem.unit,
      quantity: item.quantity,
      rate: item.clientPoItem.rate,
      amount: round2(item.quantity * item.clientPoItem.rate),
    }));
  return {
    id: entity.id,
    projectId: entity.projectId,
    number: entity.number,
    clientPurchaseOrderId: entity.clientPurchaseOrderId,
    clientPoNumber: entity.clientPurchaseOrder.poNumber,
    stage: shipmentStage(entity),
    items,
    value: round2(items.reduce((sum, item) => sum + item.amount, 0)),
    ewayBillNumber: entity.ewayBillNumber,
    ewayBillDate: iso(entity.ewayBillDate),
    vehicleNumber: entity.vehicleNumber,
    transporterName: entity.transporterName,
    freightCost: entity.freightCost,
    dispatchedAt: iso(entity.dispatchedAt),
    grnNumber: entity.grnNumber,
    grnDate: iso(entity.grnDate),
    bill: entity.bill
      ? {
          id: entity.bill.id,
          billNumber: entity.bill.billNumber,
          total: round2(entity.bill.items.reduce((sum, item) => sum + round2(item.quantity * item.rate), 0)),
        }
      : null,
    amountReceived: round2(amountReceived),
    settledAt: iso(entity.settledAt),
    notes: entity.notes,
    documents,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
