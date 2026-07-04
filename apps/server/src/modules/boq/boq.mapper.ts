import type { BoqDto, BoqItemDto, BoqItemRateBreakdownDto, BoqListItemDto } from "@bmp/types";

import { round2 } from "../../shared/utils/math.js";

import type { BoqItemWithBreakdown, BoqWithCreator } from "./boq.repository.js";

function toRateBreakdownDto(
  entity: BoqItemWithBreakdown["rateBreakdown"],
): BoqItemRateBreakdownDto | null {
  if (!entity) return null;
  return {
    materialCost: entity.materialCost,
    laborCost: entity.laborCost,
    machineryCost: entity.machineryCost,
    transportCost: entity.transportCost,
    overheadPercent: entity.overheadPercent,
    profitPercent: entity.profitPercent,
    taxPercent: entity.taxPercent,
    computedRate: entity.computedRate,
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/** Flat rows (already sorted by sortOrder) -> a parentId-nested tree, one pass. */
export function buildBoqItemTree(items: BoqItemWithBreakdown[]): BoqItemDto[] {
  const byId = new Map<string, BoqItemDto>();
  for (const item of items) {
    byId.set(item.id, {
      id: item.id,
      parentId: item.parentId,
      itemCode: item.itemCode,
      description: item.description,
      category: item.category,
      unit: item.unit,
      quantity: item.quantity,
      rate: item.rate,
      amount: item.amount,
      remarks: item.remarks,
      sortOrder: item.sortOrder,
      rateBreakdown: toRateBreakdownDto(item.rateBreakdown),
      children: [],
    });
  }

  const roots: BoqItemDto[] = [];
  for (const item of items) {
    const dto = byId.get(item.id);
    if (!dto) continue;
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    if (parent) {
      parent.children.push(dto);
    } else {
      roots.push(dto);
    }
  }
  return roots;
}

export function sumItemAmounts(items: BoqItemWithBreakdown[]): number {
  return round2(items.reduce((sum, item) => sum + (item.amount ?? 0), 0));
}

export function toBoqDto(boq: BoqWithCreator, items: BoqItemWithBreakdown[]): BoqDto {
  return {
    id: boq.id,
    tenderId: boq.tenderId,
    sourceAttachmentId: boq.sourceAttachmentId,
    groupId: boq.groupId ?? boq.id,
    version: boq.version,
    isCurrent: boq.isCurrent,
    status: boq.status,
    createdBy: {
      id: boq.createdBy.id,
      firstName: boq.createdBy.firstName,
      lastName: boq.createdBy.lastName,
    },
    items: buildBoqItemTree(items),
    totalAmount: sumItemAmounts(items),
    createdAt: boq.createdAt.toISOString(),
    updatedAt: boq.updatedAt.toISOString(),
  };
}

export function toBoqListItemDto(boq: BoqWithCreator, totalAmount: number): BoqListItemDto {
  return {
    id: boq.id,
    groupId: boq.groupId ?? boq.id,
    version: boq.version,
    isCurrent: boq.isCurrent,
    status: boq.status,
    totalAmount: round2(totalAmount),
    createdBy: {
      id: boq.createdBy.id,
      firstName: boq.createdBy.firstName,
      lastName: boq.createdBy.lastName,
    },
    createdAt: boq.createdAt.toISOString(),
  };
}
