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
  CreateOrganizationData,
  IOrganizationsRepository,
  OrganizationEntity,
  UpdateOrganizationData,
} from "../organizations.repository.js";
import { OrganizationsService } from "../organizations.service.js";

function buildOrg(overrides: Partial<OrganizationEntity> = {}): OrganizationEntity {
  const now = new Date();
  return {
    id: randomUUID(),
    name: "Acme Corp",
    type: "PRIVATE",
    address: null,
    city: null,
    state: null,
    pincode: null,
    gstNumber: null,
    website: null,
    notes: null,
    createdById: randomUUID(),
    _count: { tenders: 0 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as OrganizationEntity;
}

class FakeOrganizationsRepository implements IOrganizationsRepository {
  organizations = new Map<string, OrganizationEntity>();
  tenderCounts = new Map<string, number>();

  async findById(id: string) {
    return this.organizations.get(id) ?? null;
  }

  async findMany() {
    const items = [...this.organizations.values()];
    return { items, totalItems: items.length };
  }

  async create(data: CreateOrganizationData) {
    const org = buildOrg({ id: randomUUID(), ...data });
    this.organizations.set(org.id, org);
    return org;
  }

  async update(id: string, data: UpdateOrganizationData) {
    const org = this.organizations.get(id);
    if (!org) throw new Error("not found");
    Object.assign(org, data);
    return org;
  }

  async delete(id: string) {
    this.organizations.delete(id);
  }

  async countTenders(organizationId: string) {
    return this.tenderCounts.get(organizationId) ?? 0;
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

describe("OrganizationsService", () => {
  let repository: FakeOrganizationsRepository;
  let auditService: AuditService;
  let contactsRepository: FakeContactsRepository;
  let service: OrganizationsService;
  const actorId = randomUUID();

  beforeEach(() => {
    repository = new FakeOrganizationsRepository();
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    contactsRepository = new FakeContactsRepository();
    service = new OrganizationsService(repository, auditService, new ContactsService(contactsRepository));
  });

  it("creates an organization", async () => {
    const dto = await service.create({ name: "Acme", type: "PRIVATE", createdById: actorId });
    expect(dto.name).toBe("Acme");
    expect(dto.tenderCount).toBe(0);
  });

  it("throws NotFoundError updating a missing organization", async () => {
    await expect(service.update(randomUUID(), { name: "X" }, actorId)).rejects.toThrow(NotFoundError);
  });

  it("blocks deletion when referenced by tenders", async () => {
    const org = await repository.create({ name: "Referenced", type: "GOVERNMENT", createdById: actorId });
    repository.tenderCounts.set(org.id, 2);
    await expect(service.delete(org.id, actorId)).rejects.toThrow(ConflictError);
  });

  it("allows deletion when not referenced by any tender", async () => {
    const org = await repository.create({ name: "Unreferenced", type: "GOVERNMENT", createdById: actorId });
    await service.delete(org.id, actorId);
    expect(await repository.findById(org.id)).toBeNull();
  });

  it("adds a contact to an organization", async () => {
    const org = await repository.create({ name: "WithContact", type: "PRIVATE", createdById: actorId });
    const dto = await service.addContact(org.id, { name: "Jane Doe" }, actorId, randomUUID());
    expect(dto.contacts).toHaveLength(1);
    expect(dto.contacts[0]!.name).toBe("Jane Doe");
  });

  it("rejects updating a contact that belongs to a different organization", async () => {
    const orgA = await repository.create({ name: "OrgA", type: "PRIVATE", createdById: actorId });
    const orgB = await repository.create({ name: "OrgB", type: "PRIVATE", createdById: actorId });
    const businessId = randomUUID();
    await service.addContact(orgA.id, { name: "Contact A" }, actorId, businessId);
    const contacts = await service.getById(orgA.id);
    const contactId = contacts.contacts[0]!.id;

    await expect(
      service.updateContact(orgB.id, contactId, { name: "Hacked" }, actorId, businessId),
    ).rejects.toThrow(NotFoundError);
  });
});
