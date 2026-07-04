import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient, VendorCategory } from "@bmp/database";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

const vendorWithContacts = {
  include: {
    contacts: { orderBy: { isPrimary: "desc" } },
    ratings: { select: { rating: true } },
    _count: { select: { ratings: true } },
  },
} satisfies Prisma.VendorDefaultArgs;

export type VendorWithContacts = Prisma.VendorGetPayload<typeof vendorWithContacts>;

const vendorRatingWithRater = {
  include: { ratedBy: { select: { id: true, firstName: true, lastName: true } } },
} satisfies Prisma.VendorRatingDefaultArgs;

export type VendorRatingWithRater = Prisma.VendorRatingGetPayload<typeof vendorRatingWithRater>;

export interface CreateVendorData {
  name: string;
  category: VendorCategory;
  gstNumber?: string | null;
  panNumber?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankIfscCode?: string | null;
  notes?: string | null;
  createdById: string;
}

export type UpdateVendorData = Partial<Omit<CreateVendorData, "createdById">> & { isActive?: boolean };

export interface VendorFilters {
  search?: string;
  category?: VendorCategory;
  isActive?: boolean;
}

export interface CreateContactData {
  vendorId: string;
  name: string;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
}

export type UpdateContactData = Partial<Omit<CreateContactData, "vendorId">>;

export interface IVendorsRepository {
  findById(id: string): Promise<VendorWithContacts | null>;
  findMany(
    pagination: PaginationParams,
    filters: VendorFilters,
  ): Promise<{ items: VendorWithContacts[]; totalItems: number }>;
  create(data: CreateVendorData): Promise<VendorWithContacts>;
  update(id: string, data: UpdateVendorData): Promise<VendorWithContacts>;
  delete(id: string): Promise<void>;
  countPurchaseOrders(vendorId: string): Promise<number>;
  createContact(data: CreateContactData): Promise<void>;
  updateContact(id: string, data: UpdateContactData): Promise<void>;
  deleteContact(id: string): Promise<void>;
  findRatings(vendorId: string): Promise<VendorRatingWithRater[]>;
}

export class VendorsRepository implements IVendorsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<VendorWithContacts | null> {
    return this.prisma.vendor.findUnique({ where: { id }, ...vendorWithContacts });
  }

  async findMany(
    pagination: PaginationParams,
    filters: VendorFilters,
  ): Promise<{ items: VendorWithContacts[]; totalItems: number }> {
    const where: Prisma.VendorWhereInput = {
      category: filters.category,
      isActive: filters.isActive,
      ...(filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.vendor.findMany({
        where,
        ...vendorWithContacts,
        orderBy: { name: "asc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.vendor.count({ where }),
    ]);

    return { items, totalItems };
  }

  create(data: CreateVendorData): Promise<VendorWithContacts> {
    return this.prisma.vendor.create({ data: { id: randomUUID(), ...data }, ...vendorWithContacts });
  }

  update(id: string, data: UpdateVendorData): Promise<VendorWithContacts> {
    return this.prisma.vendor.update({ where: { id }, data, ...vendorWithContacts });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.vendor.delete({ where: { id } });
  }

  countPurchaseOrders(vendorId: string): Promise<number> {
    return this.prisma.purchaseOrder.count({ where: { vendorId } });
  }

  async createContact(data: CreateContactData): Promise<void> {
    await this.prisma.vendorContact.create({ data: { id: randomUUID(), ...data } });
  }

  async updateContact(id: string, data: UpdateContactData): Promise<void> {
    await this.prisma.vendorContact.update({ where: { id }, data });
  }

  async deleteContact(id: string): Promise<void> {
    await this.prisma.vendorContact.delete({ where: { id } });
  }

  findRatings(vendorId: string): Promise<VendorRatingWithRater[]> {
    return this.prisma.vendorRating.findMany({
      where: { vendorId },
      orderBy: { createdAt: "desc" },
      ...vendorRatingWithRater,
    });
  }
}
