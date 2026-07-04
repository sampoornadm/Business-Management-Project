import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { AuditService } from "../../audit/audit.service.js";
import type {
  CreateContactData,
  CreateOrganizationData,
  IOrganizationsRepository,
  OrganizationWithContacts,
  UpdateContactData,
  UpdateOrganizationData,
} from "../organizations.repository.js";
import { OrganizationsService } from "../organizations.service.js";

function buildOrg(overrides: Partial<OrganizationWithContacts> = {}): OrganizationWithContacts {
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
    contacts: [],
    _count: { tenders: 0 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as OrganizationWithContacts;
}

class FakeOrganizationsRepository implements IOrganizationsRepository {
  organizations = new Map<string, OrganizationWithContacts>();
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

  async createContact(data: CreateContactData) {
    const org = this.organizations.get(data.organizationId);
    if (!org) throw new Error("not found");
    org.contacts.push({
      id: randomUUID(),
      organizationId: data.organizationId,
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
    for (const org of this.organizations.values()) {
      const contact = org.contacts.find((c) => c.id === id);
      if (contact) Object.assign(contact, data);
    }
  }

  async deleteContact(id: string) {
    for (const org of this.organizations.values()) {
      org.contacts = org.contacts.filter((c) => c.id !== id);
    }
  }
}

describe("OrganizationsService", () => {
  let repository: FakeOrganizationsRepository;
  let auditService: AuditService;
  let service: OrganizationsService;
  const actorId = randomUUID();

  beforeEach(() => {
    repository = new FakeOrganizationsRepository();
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    service = new OrganizationsService(repository, auditService);
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
    const dto = await service.addContact(org.id, { name: "Jane Doe" }, actorId);
    expect(dto.contacts).toHaveLength(1);
    expect(dto.contacts[0]!.name).toBe("Jane Doe");
  });

  it("rejects updating a contact that belongs to a different organization", async () => {
    const orgA = await repository.create({ name: "OrgA", type: "PRIVATE", createdById: actorId });
    const orgB = await repository.create({ name: "OrgB", type: "PRIVATE", createdById: actorId });
    await service.addContact(orgA.id, { name: "Contact A" }, actorId);
    const contactId = (await repository.findById(orgA.id))!.contacts[0]!.id;

    await expect(
      service.updateContact(orgB.id, contactId, { name: "Hacked" }, actorId),
    ).rejects.toThrow(NotFoundError);
  });
});
