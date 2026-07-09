import type {
  VendorContactDto,
  VendorDto,
  VendorItemTagDto,
  VendorListItemDto,
  VendorPerformanceDto,
  VendorRatingDto,
} from "@bmp/types";

import type { VendorRatingWithRater, VendorWithContacts } from "./vendors.repository.js";

function toContactDto(contact: VendorWithContacts["contacts"][number]): VendorContactDto {
  return {
    id: contact.id,
    name: contact.name,
    designation: contact.designation,
    email: contact.email,
    phone: contact.phone,
    isPrimary: contact.isPrimary,
    createdAt: contact.createdAt.toISOString(),
  };
}

function toItemTagDto(tag: VendorWithContacts["itemTags"][number]): VendorItemTagDto {
  return {
    id: tag.id,
    itemType: tag.itemType,
    make: tag.make,
    createdAt: tag.createdAt.toISOString(),
  };
}

function averageOf(ratings: { rating: number }[]): number | null {
  if (ratings.length === 0) return null;
  const sum = ratings.reduce((total, r) => total + r.rating, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
}

export function toVendorListItemDto(entity: VendorWithContacts): VendorListItemDto {
  return {
    id: entity.id,
    name: entity.name,
    category: entity.category,
    city: entity.city,
    state: entity.state,
    isActive: entity.isActive,
    averageRating: averageOf(entity.ratings),
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toVendorDto(entity: VendorWithContacts): VendorDto {
  return {
    ...toVendorListItemDto(entity),
    gstNumber: entity.gstNumber,
    panNumber: entity.panNumber,
    address: entity.address,
    bankAccountName: entity.bankAccountName,
    bankAccountNumber: entity.bankAccountNumber,
    bankIfscCode: entity.bankIfscCode,
    notes: entity.notes,
    contacts: entity.contacts.map(toContactDto),
    itemTags: entity.itemTags.map(toItemTagDto),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function toVendorRatingDto(entity: VendorRatingWithRater): VendorRatingDto {
  return {
    id: entity.id,
    purchaseOrderId: entity.purchaseOrderId,
    rating: entity.rating,
    remarks: entity.remarks,
    ratedBy: {
      id: entity.ratedBy.id,
      firstName: entity.ratedBy.firstName,
      lastName: entity.ratedBy.lastName,
    },
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toVendorPerformanceDto(
  vendorId: string,
  ratings: VendorRatingWithRater[],
): VendorPerformanceDto {
  return {
    vendorId,
    averageRating: averageOf(ratings),
    totalRatings: ratings.length,
    ratings: ratings.map(toVendorRatingDto),
  };
}
