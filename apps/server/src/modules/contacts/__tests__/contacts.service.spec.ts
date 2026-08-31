import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import type {
  ContactEntityType,
  ContactLookupKind,
  ContactWithChildren,
  CreateContactData,
  IContactsRepository,
  UpdateContactData,
} from "../contacts.repository.js";
import { ContactsService } from "../contacts.service.js";

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

describe("ContactsService", () => {
  let repository: FakeContactsRepository;
  let service: ContactsService;
  const businessId = randomUUID();
  const entityId = randomUUID();

  beforeEach(() => {
    repository = new FakeContactsRepository();
    service = new ContactsService(repository);
  });

  it("registers a new department value when creating a contact", async () => {
    await service.createContact("ORGANIZATION", entityId, { name: "Alice", department: "Engineering" }, businessId);
    const values = await service.listLookupOptions(businessId, "DEPARTMENT");
    expect(values).toEqual(["Engineering"]);
  });

  it("does not register an empty department/designation", async () => {
    await service.createContact("ORGANIZATION", entityId, { name: "Bob" }, businessId);
    expect(await service.listLookupOptions(businessId, "DEPARTMENT")).toEqual([]);
    expect(await service.listLookupOptions(businessId, "DESIGNATION")).toEqual([]);
  });

  it("registers a new designation value when updating a contact", async () => {
    await service.createContact("ORGANIZATION", entityId, { name: "Carol" }, businessId);
    const [contact] = await service.listContacts("ORGANIZATION", entityId);
    await service.updateContact(contact!.id, { designation: "Site Manager" }, businessId);
    expect(await service.listLookupOptions(businessId, "DESIGNATION")).toEqual(["Site Manager"]);
  });

  it("reports whether a contact belongs to the given entity", async () => {
    await service.createContact("VENDOR", entityId, { name: "Dana" }, businessId);
    const [contact] = await service.listContacts("VENDOR", entityId);
    expect(await service.belongsToEntity(contact!.id, "VENDOR", entityId)).toBe(true);
    expect(await service.belongsToEntity(contact!.id, "ORGANIZATION", entityId)).toBe(false);
  });
});