import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { AuditService } from "../../audit/audit.service.js";
import type {
  CreateContactData,
  CreateItemTagData,
  CreateVendorData,
  IVendorsRepository,
  UpdateContactData,
  UpdateVendorData,
  VendorFilters,
  VendorItemTypeMatch,
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
    itemTags: [],
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

  async findByNameExact(name: string) {
    const vendor = [...this.vendors.values()].find((v) => v.name.toLowerCase() === name.toLowerCase());
    return vendor ? { id: vendor.id, name: vendor.name } : null;
  }

  async createItemTag(data: CreateItemTagData) {
    const vendor = this.vendors.get(data.vendorId);
    if (!vendor) throw new Error("not found");
    (vendor.itemTags as unknown[]).push({
      id: randomUUID(),
      itemType: data.itemType,
      make: data.make ?? null,
      createdAt: new Date(),
    });
  }

  async deleteItemTag(id: string) {
    for (const vendor of this.vendors.values()) {
      vendor.itemTags = vendor.itemTags.filter((tag) => tag.id !== id) as never;
    }
  }

  async findDistinctItemTypes(): Promise<string[]> {
    const types = new Set<string>();
    for (const vendor of this.vendors.values()) {
      for (const tag of vendor.itemTags) types.add(tag.itemType);
    }
    return [...types];
  }

  async findActiveVendorsByItemTypes(itemTypes: string[]): Promise<VendorItemTypeMatch[]> {
    const matches: VendorItemTypeMatch[] = [];
    for (const vendor of this.vendors.values()) {
      if (!vendor.isActive) continue;
      for (const tag of vendor.itemTags) {
        if (itemTypes.includes(tag.itemType)) {
          matches.push({ vendorId: vendor.id, vendorName: vendor.name, itemType: tag.itemType, make: tag.make });
        }
      }
    }
    return matches;
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

  it("adds and removes an item tag", async () => {
    const vendor = await service.create({
      name: "Ace Steel Suppliers",
      category: "MATERIAL_SUPPLIER",
      createdById: actorId,
    });
    const updated = await service.addItemTag(vendor.id, { itemType: "FLANGE", make: "ACME" }, actorId);
    expect(updated.itemTags).toEqual([
      expect.objectContaining({ itemType: "FLANGE", make: "ACME" }),
    ]);

    const afterDelete = await service.removeItemTag(vendor.id, updated.itemTags[0]!.id, actorId);
    expect(afterDelete.itemTags).toHaveLength(0);
  });

  it("rejects removing an item tag that doesn't belong to the vendor", async () => {
    const vendorOne = await service.create({
      name: "Ace Steel Suppliers",
      category: "MATERIAL_SUPPLIER",
      createdById: actorId,
    });
    const vendorTwo = await service.create({
      name: "Beta Traders",
      category: "MATERIAL_SUPPLIER",
      createdById: actorId,
    });
    const tagged = await service.addItemTag(vendorOne.id, { itemType: "FLANGE" }, actorId);

    await expect(
      service.removeItemTag(vendorTwo.id, tagged.itemTags[0]!.id, actorId),
    ).rejects.toThrow(NotFoundError);
  });

  describe("importItemTags", () => {
    it("imports tags for vendors matched by exact name and reports unmatched rows", async () => {
      await service.create({ name: "Ace Steel Suppliers", category: "MATERIAL_SUPPLIER", createdById: actorId });

      const workbook = new (await import("exceljs")).default.Workbook();
      const sheet = workbook.addWorksheet("Tags");
      sheet.addRow(["Vendor Name", "Item Type", "Make"]);
      sheet.addRow(["Ace Steel Suppliers", "FLANGE", "ACME"]);
      sheet.addRow(["Nonexistent Vendor Co", "GASKET", ""]);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const result = await service.importItemTags(buffer, actorId);

      expect(result.imported).toBe(1);
      expect(result.skipped).toEqual([
        expect.objectContaining({ vendorName: "Nonexistent Vendor Co", reason: expect.any(String) }),
      ]);
    });
  });
});
