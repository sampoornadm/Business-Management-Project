import type { AttachmentDto, ClientPurchaseOrderDto } from "@bmp/types";

import { round2 } from "../../shared/utils/math.js";

import { type BoqLine, flagPoLine } from "./client-purchase-orders.checks.js";
import type { ClientPurchaseOrderWithItems } from "./client-purchase-orders.repository.js";

export interface ClientPoCheckContext {
  boqById: Map<string, BoqLine>;
  orderedQuantity: Map<string, number>;
}

export function toClientPurchaseOrderDto(
  entity: ClientPurchaseOrderWithItems,
  context: ClientPoCheckContext,
  documents: AttachmentDto[],
): ClientPurchaseOrderDto {
  const items = entity.items.map((item) => {
    const boqLine = item.boqItemId ? context.boqById.get(item.boqItemId) : undefined;
    const orderedTotal = item.boqItemId ? (context.orderedQuantity.get(item.boqItemId) ?? 0) : 0;
    return {
      id: item.id,
      boqItemId: item.boqItemId,
      itemCode: item.itemCode,
      description: item.description,
      unit: item.unit,
      quantity: item.quantity,
      rate: item.rate,
      amount: round2(item.quantity * item.rate),
      sortOrder: item.sortOrder,
      quotedRate: boqLine?.rate ?? null,
      boqQuantity: boqLine?.quantity ?? null,
      boqUnit: boqLine?.unit ?? null,
      flags: flagPoLine(item, boqLine, orderedTotal),
    };
  });

  return {
    id: entity.id,
    projectId: entity.projectId,
    poNumber: entity.poNumber,
    poDate: entity.poDate.toISOString(),
    deliveryDueDate: entity.deliveryDueDate.toISOString(),
    notes: entity.notes,
    poValue: round2(items.reduce((sum, item) => sum + item.amount, 0)),
    items,
    documents,
    createdBy: entity.createdBy,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
