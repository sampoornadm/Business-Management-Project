import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { AuditService } from "../../audit/audit.service.js";
import type {
  CreateContactData,
  CreateVendorData,
  IVendorsRepository,
  UpdateContactData,
  UpdateVendorData,
  VendorFilters,
  VendorRatingWithRater,
  VendorWithContacts,
} from "../vendors.repository.js";
import { VendorsService } from "../vendors.service.js";

function buildVendor(overrides: Partial<VendorWithContacts> = {}): VendorWithContacts {
  const now = new Date();
  return {
    id: randomUUID(),
    name: "Ace Steel Suppliers",
    category: "MATERIAL_SUPPLIER",
    gstNumber: null,
    panNumber: null,
    address: null,
    city: null,
    state: null,
    bankAccountName: null,
    bankAccountNumber: null,
    bankIfscCode: null,
    notes: null,
    isActive: true,
    createdById: randomUUID(),
    contacts: [],
    ratings: [],
    _count: { ratings: 0 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as unknown as VendorWithContacts;
}

class FakeVendorsRepository implements IVendorsRepository {
  vendors = new Map<string, VendorWithContacts>();
  poCounts = new Map<string, number>();

  async findById(id: string) {
    return this.vendors.get(id) ?? null;
  }

  async findMany(_pagination: unknown, filters: VendorFilters) {
    let items = [...this.vendors.values()];
    if (filters.category) items = items.filter((v) => v.category === filters.category);
    return { items, totalItems: items.length };
  }

  async create(data: CreateVendorData) {
    const vendor = buildVendor({ id: randomUUID(), ...data });
    this.vendors.set(vendor.id, vendor);
    return vendor;
  }

  async update(id: string, data: UpdateVendorData) {
    const vendor = this.vendors.get(id);
    if (!vendor) throw new Error("not found");
    Object.assign(vendor, data);
    return vendor;
  }

  async delete(id: string) {
    this.vendors.delete(id);
  }

  async countPurchaseOrders(vendorId: string) {
    return this.poCounts.get(vendorId) ?? 0;
  }

  async createContact(data: CreateContactData) {
    const vendor = this.vendors.get(data.vendorId);
    if (!vendor) throw new Error("not found");
    (vendor.contacts as unknown[]).push({
      id: randomUUID(),
      name: data.name,
      designation: data.designation ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      isPrimary: data.isPrimary ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async updateContact(id: string, data: UpdateContactData) {
    for (const vendor of this.vendors.values()) {
      const contact = vendor.contacts.find((c) => c.id === id);
      if (contact) Object.assign(contact, data);
    }
  }

  async deleteContact(id: string) {
    for (const vendor of this.vendors.values()) {
      vendor.contacts = vendor.contacts.filter((c) => c.id !== id) as never;
    }
  }

  async findRatings(_vendorId: string): Promise<VendorRatingWithRater[]> {
    return [];
  }
}

describe("VendorsService", () => {
  let repository: FakeVendorsRepository;
  let auditService: AuditService;
  let service: VendorsService;
  const actorId = randomUUID();

  beforeEach(() => {
    repository = new FakeVendorsRepository();
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    service = new VendorsService(repository, auditService);
  });

  it("creates a vendor", async () => {
    const dto = await service.create({
      name: "Ace Steel Suppliers",
      category: "MATERIAL_SUPPLIER",
      createdById: actorId,
    });
    expect(dto.name).toBe("Ace Steel Suppliers");
    expect(dto.averageRating).toBeNull();
  });

  it("throws when getting an unknown vendor", async () => {
    await expect(service.getById(randomUUID())).rejects.toThrow(NotFoundError);
  });

  it("blocks deletion when referenced by a purchase order", async () => {
    const vendor = await service.create({
      name: "Ace Steel Suppliers",
      category: "MATERIAL_SUPPLIER",
      createdById: actorId,
    });
    repository.poCounts.set(vendor.id, 2);
    await expect(service.delete(vendor.id, actorId)).rejects.toThrow(ConflictError);
  });

  it("deletes a vendor with no purchase orders", async () => {
    const vendor = await service.create({
      name: "Ace Steel Suppliers",
      category: "MATERIAL_SUPPLIER",
      createdById: actorId,
    });
    await service.delete(vendor.id, actorId);
    await expect(service.getById(vendor.id)).rejects.toThrow(NotFoundError);
  });

  it("adds and removes a contact", async () => {
    const vendor = await service.create({
      name: "Ace Steel Suppliers",
      category: "MATERIAL_SUPPLIER",
      createdById: actorId,
    });
    const updated = await service.addContact(vendor.id, { name: "Raj Kumar" }, actorId);
    expect(updated.contacts).toHaveLength(1);

    const afterDelete = await service.deleteContact(vendor.id, updated.contacts[0]!.id, actorId);
    expect(afterDelete.contacts).toHaveLength(0);
  });
});
