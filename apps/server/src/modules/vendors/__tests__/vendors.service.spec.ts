import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { AuditService } from "../../audit/audit.service.js";
import type {
  ContactEntityType,
  ContactLookupKind,
  ContactWithChildren,
  CreateContactData,
  IContactsRepository,
  UpdateContactData,
} from "../../contacts/contacts.repository.js";
import { ContactsService } from "../../contacts/contacts.service.js";
import type {
  CreateItemTagData,
  CreateVendorData,
  IVendorsRepository,
  UpdateVendorData,
  VendorEntity,
  VendorFilters,
  VendorItemTypeMatch,
  VendorRatingWithRater,
} from "../vendors.repository.js";
import { VendorsService } from "../vendors.service.js";

function buildVendor(overrides: Partial<VendorEntity> = {}): VendorEntity {
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
    itemTags: [],
    ratings: [],
    _count: { ratings: 0 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as unknown as VendorEntity;
}

class FakeVendorsRepository implements IVendorsRepository {
  vendors = new Map<string, VendorEntity>();
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

class FakeContactsRepository implements IContactsRepository {
  contacts = new Map<string, ContactWithChildren>();
  lookupOptions = new Map<string, Set<string>>();

  async findByEntity(entityType: ContactEntityType, entityId: string) {
    return [...this.contacts.values()].filter(
      (c) => c.entityType === entityType && c.entityId === entityId,
    );
  }

  async create(data: CreateContactData) {
    if (data.isPrimary) {
      for (const c of this.contacts.values()) {
        if (c.entityType === data.entityType && c.entityId === data.entityId) c.isPrimary = false;
      }
    }
    const contact = {
      id: randomUUID(),
      entityType: data.entityType,
      entityId: data.entityId,
      name: data.name,
      department: data.department ?? null,
      designation: data.designation ?? null,
      notes: data.notes ?? null,
      isPrimary: data.isPrimary ?? false,
      phones: (data.phones ?? []).map((p) => ({ id: randomUUID(), contactId: "", ...p })),
      emails: (data.emails ?? []).map((e) => ({ id: randomUUID(), contactId: "", ...e })),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as ContactWithChildren;
    this.contacts.set(contact.id, contact);
    return contact;
  }

  async update(id: string, data: UpdateContactData) {
    const contact = this.contacts.get(id);
    if (!contact) throw new Error("not found");
    if (data.isPrimary) {
      for (const c of this.contacts.values()) {
        if (c.id !== id && c.entityType === contact.entityType && c.entityId === contact.entityId) {
          c.isPrimary = false;
        }
      }
    }
    Object.assign(contact, data);
    return contact;
  }

  async delete(id: string) {
    this.contacts.delete(id);
  }

  async belongsToEntity(contactId: string, entityType: ContactEntityType, entityId: string) {
    const contact = this.contacts.get(contactId);
    return Boolean(contact && contact.entityType === entityType && contact.entityId === entityId);
  }

  async listLookupOptions(businessId: string, kind: ContactLookupKind) {
    return [...(this.lookupOptions.get(`${businessId}:${kind}`) ?? new Set<string>())];
  }

  async upsertLookupOptionIfMissing(businessId: string, kind: ContactLookupKind, value: string) {
    const key = `${businessId}:${kind}`;
    const set = this.lookupOptions.get(key) ?? new Set<string>();
    set.add(value);
    this.lookupOptions.set(key, set);
  }
}

describe("VendorsService", () => {
  let repository: FakeVendorsRepository;
  let auditService: AuditService;
  let contactsRepository: FakeContactsRepository;
  let service: VendorsService;
  const actorId = randomUUID();

  beforeEach(() => {
    repository = new FakeVendorsRepository();
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    contactsRepository = new FakeContactsRepository();
    service = new VendorsService(repository, auditService, new ContactsService(contactsRepository));
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
    const updated = await service.addContact(vendor.id, { name: "Raj Kumar" }, actorId, randomUUID());
    expect(updated.contacts).toHaveLength(1);

    const afterDelete = await service.deleteContact(vendor.id, updated.contacts[0]!.id, actorId);
    expect(afterDelete.contacts).toHaveLength(0);
  });

  it("rejects updating a contact that belongs to a different vendor", async () => {
    const vendorA = await service.create({
      name: "Ace Steel Suppliers",
      category: "MATERIAL_SUPPLIER",
      createdById: actorId,
    });
    const vendorB = await service.create({
      name: "Beta Traders",
      category: "MATERIAL_SUPPLIER",
      createdById: actorId,
    });
    const businessId = randomUUID();
    await service.addContact(vendorA.id, { name: "Contact A" }, actorId, businessId);
    const withContact = await service.getById(vendorA.id);
    const contactId = withContact.contacts[0]!.id;

    await expect(
      service.updateContact(vendorB.id, contactId, { name: "Hacked" }, actorId, businessId),
    ).rejects.toThrow(NotFoundError);
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
