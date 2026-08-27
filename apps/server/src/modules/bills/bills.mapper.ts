import type { BillDto, BillItemDto, BillListItemDto } from "@bmp/types";

import { round2 } from "../../shared/utils/math.js";

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
