import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditService } from "../../audit/audit.service.js";
import type {
  BusinessFilters,
  BusinessWithContacts,
  CreateBusinessData,
  IBusinessesRepository,
  MemberWithRole,
  UpdateBusinessData,
} from "../businesses.repository.js";
import { BusinessesService } from "../businesses.service.js";

function buildBusiness(overrides: Partial<BusinessWithContacts> = {}): BusinessWithContacts {
  return {
    id: randomUUID(),
    name: "Archie Udyog",
    code: "ARCHIE",
    address: null,
    city: null,
    state: null,
    pincode: null,
    gstNumber: null,
    udyamRegistrationNumber: null,
    msmeCategory: null,
    panNumber: null,
    website: null,
    notes: null,
    isActive: true,
    contacts: [],
    _count: { tenders: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BusinessWithContacts;
}

class FakeBusinessesRepository implements Partial<IBusinessesRepository> {
  businesses = new Map<string, BusinessWithContacts>();
  members = new Map<string, MemberWithRole[]>();

  async findById(id: string) {
    return this.businesses.get(id) ?? null;
  }

  async findMany(_pagination: unknown, _filters: BusinessFilters) {
    const items = Array.from(this.businesses.values());
    return { items, totalItems: items.length };
  }

  async create(data: CreateBusinessData) {
    const business = buildBusiness({ id: randomUUID(), ...data });
    this.businesses.set(business.id, business);
    return business;
  }

  async update(id: string, data: UpdateBusinessData) {
    const existing = this.businesses.get(id)!;
    const updated = { ...existing, ...data };
    this.businesses.set(id, updated);
    return updated;
  }

  async delete(id: string) {
    this.businesses.delete(id);
  }

  async countTenders(_id: string) {
    return 0;
  }

  async findMembership(userId: string, businessId: string) {
    const list = this.members.get(businessId) ?? [];
    const found = list.find((m) => m.userId === userId);
    return found ? { roleId: found.roleId } : null;
  }

  async listMembers(businessId: string) {
    return this.members.get(businessId) ?? [];
  }

  async addMember(businessId: string, userId: string, roleId: string) {
    const list = this.members.get(businessId) ?? [];
    list.push({
      userId,
      businessId,
      roleId,
      roleName: "ADMIN",
      userEmail: "x@x.com",
      userFirstName: "X",
      userLastName: "Y",
    });
    this.members.set(businessId, list);
  }

  async removeMember(businessId: string, userId: string) {
    const list = this.members.get(businessId) ?? [];
    this.members.set(
      businessId,
      list.filter((m) => m.userId !== userId),
    );
  }
}

describe("BusinessesService", () => {
  let repository: FakeBusinessesRepository;
  let auditService: AuditService;
  let service: BusinessesService;

  beforeEach(() => {
    repository = new FakeBusinessesRepository();
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    service = new BusinessesService(repository as unknown as IBusinessesRepository, auditService);
  });

  it("creates a business and logs BUSINESS_CREATED", async () => {
    const dto = await service.create({ name: "Archie Udyog", code: "ARCHIE" }, "actor-1");
    expect(dto.name).toBe("Archie Udyog");
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: "BUSINESS_CREATED" }));
  });

  it("prevents removing the last member of a business", async () => {
    const business = await service.create({ name: "Archie Udyog", code: "ARCHIE" }, "actor-1");
    await service.addMember(business.id, "user-1", "role-1", "actor-1");
    await expect(service.removeMember(business.id, "user-1", "actor-1")).rejects.toThrow(
      "Cannot remove the last member of a business",
    );
  });

  it("rejects adding a member who is already in the business", async () => {
    const business = await service.create({ name: "Archie Udyog", code: "ARCHIE" }, "actor-1");
    await service.addMember(business.id, "user-1", "role-1", "actor-1");
    await expect(service.addMember(business.id, "user-1", "role-1", "actor-1")).rejects.toThrow(
      "User is already a member of this business",
    );
  });
});
