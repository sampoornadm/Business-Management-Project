import type {
  RfqDto,
  RfqItemDto,
  RfqListItemDto,
  RfqQuoteDto,
  RfqVendorInviteDto,
} from "@bmp/types";

import type { RfqDetail, RfqItemDetail, RfqListItem } from "./rfq.repository.js";

function toQuoteDto(quote: RfqItemDetail["quotes"][number]): RfqQuoteDto {
  return {
    vendorId: quote.vendorId,
    rate: quote.rate,
    remarks: quote.remarks,
    updatedAt: quote.updatedAt.toISOString(),
  };
}

function toItemDto(item: RfqItemDetail): RfqItemDto {
  return {
    id: item.id,
    boqItemId: item.boqItemId,
    description: item.description,
    unit: item.unit,
    quantity: item.quantity,
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
    awardedVendorId: entity.awardedVendorId,
    itemCount: entity._count.items,
    vendorCount: entity._count.vendorInvites,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toRfqDto(entity: RfqDetail): RfqDto {
  return {
    id: entity.id,
    title: entity.title,
    tenderId: entity.tenderId,
    status: entity.status,
    dueDate: entity.dueDate ? entity.dueDate.toISOString() : null,
    awardedVendorId: entity.awardedVendorId,
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
