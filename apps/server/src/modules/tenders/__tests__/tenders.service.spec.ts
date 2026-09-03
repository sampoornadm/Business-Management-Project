import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BadRequestError, ConflictError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { EmailService } from "../../../infra/mailer/email.service.js";
import type { AttachmentsService } from "../../attachments/attachments.service.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { IBusinessesRepository } from "../../businesses/businesses.repository.js";
import type { NotificationsService } from "../../notifications/notifications.service.js";
import type { IOrganizationsRepository, OrganizationEntity } from "../../organizations/organizations.repository.js";
import type { ITagsRepository } from "../../tags/tags.repository.js";
import type { IUsersRepository } from "../../users/users.repository.js";
import type {
  CreateCompetitorData,
  CreateTenderData,
  ITendersRepository,
  StatusChangeData,
  TenderDetail,
  UpdateCompetitorData,
  UpdateTenderData,
} from "../tenders.repository.js";
import { TendersService } from "../tenders.service.js";

const CLIENT_ID = randomUUID();
const OTHER_CLIENT_ID = randomUUID();

function buildTender(overrides: Partial<TenderDetail> = {}): TenderDetail {
  const now = new Date();
  return {
    id: randomUUID(),
    tenderNumber: "TND-0001",
    title: "Road Construction",
    department: "PWD",
    clientId: CLIENT_ID,
    client: { id: CLIENT_ID, name: "Public Works Department", type: "GOVERNMENT" },
    type: "OPEN",
    category: "ROAD",
    location: "City Center",
    state: "Maharashtra",
    estimatedCost: 1_000_000,
    emdAmount: null,
    tenderFee: null,
    documentFee: null,
    submissionDate: now,
    openingDate: null,
    validityPeriodDays: null,
    status: "DRAFT",
    statusChangedAt: now,
    priority: "MEDIUM",
    kind: "TENDER",
    convertedFromId: null,
    convertedFrom: null,
    description: null,
    remarks: null,
    winnerName: null,
    winningBidAmount: null,
    lossReason: null,
    createdById: randomUUID(),
    createdBy: { id: randomUUID(), firstName: "Tanya", lastName: "Manager" },
    assignees: [],
    competitors: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as TenderDetail;
}

class FakeTendersRepository implements Partial<ITendersRepository> {
  tenders = new Map<string, TenderDetail>();

  async findById(id: string, _businessId: string) {
    return this.tenders.get(id) ?? null;
  }

  async findByTenderNumber(tenderNumber: string, _businessId: string) {
    const found = [...this.tenders.values()].find((t) => t.tenderNumber === tenderNumber);
    return found ? { id: found.id } : null;
  }

  async findMany() {
    return { items: [], totalItems: 0 };
  }

  async create(data: CreateTenderData) {
    const tender = buildTender({
      id: randomUUID(),
      ...data,
      client: { id: data.clientId, name: "Public Works Department", type: "GOVERNMENT" },
      createdBy: { id: data.createdById, firstName: "Tanya", lastName: "Manager" },
    });
    this.tenders.set(tender.id, tender);
    return tender;
  }

  async update(id: string, data: UpdateTenderData) {
    const tender = this.tenders.get(id);
    if (!tender) throw new Error("not found");
    Object.assign(tender, data);
    // Mirrors the real repository's behavior: `update()` re-includes `convertedFrom` via
    // `tenderDetailArgs` on every call, so the fake must re-resolve it from `convertedFromId`
    // rather than leaving the stale nested object Object.assign() just skipped over.
    if ("convertedFromId" in data) {
      tender.convertedFrom = data.convertedFromId ? (this.tenders.get(data.convertedFromId) ?? null) : null;
    }
    return tender;
  }

  async updateStatus(id: string, data: StatusChangeData) {
    const tender = this.tenders.get(id);
    if (!tender) throw new Error("not found");
    Object.assign(tender, data);
    return tender;
  }

  async delete(id: string) {
    this.tenders.delete(id);
  }

  async findAssignee(tenderId: string, userId: string) {
    const tender = this.tenders.get(tenderId);
    const assignee = tender?.assignees.find((a) => a.user.id === userId);
    return assignee ? { id: assignee.id } : null;
  }

  async addAssignee(tenderId: string, userId: string, role: never, assignedById: string) {
    const tender = this.tenders.get(tenderId);
    if (!tender) throw new Error("not found");
    tender.assignees.push({
      id: randomUUID(),
      tenderId,
      userId,
      user: { id: userId, firstName: "Ethan", lastName: "Estimator", email: "estimator@bmp.local" },
      role,
      assignedById,
      assignedBy: { id: assignedById, firstName: "Tanya", lastName: "Manager" },
      createdAt: new Date(),
    } as never);
  }

  async removeAssignee(tenderId: string, userId: string) {
    const tender = this.tenders.get(tenderId);
    if (!tender) return;
    tender.assignees = tender.assignees.filter((a) => a.user.id !== userId) as never;
  }

  async listAssigneeUserIds(tenderId: string) {
    return (this.tenders.get(tenderId)?.assignees ?? []).map((a) => a.user.id);
  }

  async findCompetitorById(id: string) {
    for (const tender of this.tenders.values()) {
      const competitor = tender.competitors.find((c) => c.id === id);
      if (competitor) return { id: competitor.id, tenderId: tender.id };
    }
    return null;
  }

  async addCompetitor(tenderId: string, data: CreateCompetitorData) {
    const tender = this.tenders.get(tenderId);
    if (!tender) throw new Error("not found");
    tender.competitors.push({
      id: randomUUID(),
      tenderId,
      competitorName: data.competitorName,
      bidAmount: data.bidAmount ?? null,
      isWinningBid: data.isWinningBid ?? false,
      remarks: data.remarks ?? null,
      createdAt: new Date(),
    } as never);
  }

  async updateCompetitor(id: string, data: UpdateCompetitorData) {
    for (const tender of this.tenders.values()) {
      const competitor = tender.competitors.find((c) => c.id === id);
      if (competitor) Object.assign(competitor, data);
    }
  }

  async deleteCompetitor(id: string) {
    for (const tender of this.tenders.values()) {
      tender.competitors = tender.competitors.filter((c) => c.id !== id) as never;
    }
  }

  async setTags() {
    // not exercised in these unit tests
  }

  async countByStatus(businessId: string) {
    const counts = new Map<string, number>();
    for (const tender of this.tenders.values()) {
      if (tender.businessId !== businessId) continue;
      counts.set(tender.status, (counts.get(tender.status) ?? 0) + 1);
    }
    return [...counts.entries()].map(([status, count]) => ({ status: status as never, count }));
  }

  async findUpcomingDeadlines(withinDays: number, businessId: string) {
    const now = new Date();
    const until = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
    return [...this.tenders.values()]
      .filter(
        (t) =>
          t.businessId === businessId &&
          t.submissionDate >= now &&
          t.submissionDate <= until &&
          !["WON", "LOST", "CANCELLED"].includes(t.status),
      )
      .map((t) => ({ ...t, _count: { assignees: t.assignees.length } })) as never;
  }
}

class FakeOrganizationsRepository implements Partial<IOrganizationsRepository> {
  async findById(id: string): Promise<OrganizationEntity | null> {
    if (id !== CLIENT_ID && id !== OTHER_CLIENT_ID) return null;
    const now = new Date();
    return {
      id,
      name: id === CLIENT_ID ? "Public Works Department" : "Other Department",
      type: "GOVERNMENT",
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
    } as OrganizationEntity;
  }
}

class FakeUsersRepository implements Partial<IUsersRepository> {
  async findById(id: string) {
    return {
      id,
      email: "estimator@bmp.local",
      firstName: "Ethan",
      lastName: "Estimator",
    } as never;
  }
}

class FakeTagsRepository implements Partial<ITagsRepository> {
  async findById(id: string) {
    return { id, name: "Urgent", color: null, createdAt: new Date() };
  }
}

class FakeBusinessesRepository implements Partial<IBusinessesRepository> {
  async findById(id: string) {
    return { id, code: "TEST" } as never;
  }
}

const BUSINESS_ID = randomUUID();

describe("TendersService", () => {
  let tendersRepository: FakeTendersRepository;
  let auditService: AuditService;
  let notificationsService: NotificationsService;
  let emailService: EmailService;
  let service: TendersService;
  const actorId = randomUUID();
  const ctx = { businessId: BUSINESS_ID };

  const baseInput: Omit<CreateTenderData, "businessId"> = {
    tenderNumber: "TND-0001",
    title: "Road Construction",
    department: "PWD",
    clientId: CLIENT_ID,
    type: "OPEN",
    category: "ROAD",
    location: "City Center",
    state: "Maharashtra",
    estimatedCost: 1_000_000,
    submissionDate: new Date(),
    createdById: actorId,
  };

  beforeEach(() => {
    tendersRepository = new FakeTendersRepository();
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    notificationsService = {
      create: vi.fn().mockResolvedValue(undefined),
      createMany: vi.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;
    emailService = {
      queueTenderAssignedEmail: vi.fn().mockResolvedValue(undefined),
    } as unknown as EmailService;

    service = new TendersService(
      tendersRepository as unknown as ITendersRepository,
      new FakeOrganizationsRepository() as unknown as IOrganizationsRepository,
      new FakeUsersRepository() as unknown as IUsersRepository,
      new FakeTagsRepository() as unknown as ITagsRepository,
      new FakeBusinessesRepository() as unknown as IBusinessesRepository,
      auditService,
      {} as AttachmentsService,
      notificationsService,
      emailService,
    );
  });

  it("creates a tender", async () => {
    const dto = await service.create(baseInput, ctx);
    expect(dto.tenderNumber).toBe("TND-0001");
    expect(dto.status).toBe("DRAFT");
  });

  it("rejects a duplicate tender number", async () => {
    await service.create(baseInput, ctx);
    await expect(service.create(baseInput, ctx)).rejects.toThrow(ConflictError);
  });

  it("rejects an invalid client", async () => {
    await expect(
      service.create({ ...baseInput, clientId: randomUUID() }, ctx),
    ).rejects.toThrow(BadRequestError);
  });

  it("allows a valid status transition", async () => {
    const created = await service.create(baseInput, ctx);
    const updated = await service.changeStatus(created.id, { status: "SUBMITTED" }, actorId, ctx);
    expect(updated.status).toBe("SUBMITTED");
  });

  it("rejects an illegal status transition", async () => {
    const created = await service.create(baseInput, ctx);
    await expect(
      service.changeStatus(created.id, { status: "WON" }, actorId, ctx),
    ).rejects.toThrow(BadRequestError);
  });

  it("allows reopening a WON tender back to SUBMITTED", async () => {
    const created = await service.create(baseInput, ctx);
    await service.changeStatus(created.id, { status: "SUBMITTED" }, actorId, ctx);
    await service.changeStatus(created.id, { status: "WON" }, actorId, ctx);
    const reopened = await service.changeStatus(created.id, { status: "SUBMITTED" }, actorId, ctx);
    expect(reopened.status).toBe("SUBMITTED");
  });

  it("allows reopening a CANCELLED tender all the way back to DRAFT", async () => {
    const created = await service.create(baseInput, ctx);
    await service.changeStatus(created.id, { status: "CANCELLED" }, actorId, ctx);
    const reopened = await service.changeStatus(created.id, { status: "DRAFT" }, actorId, ctx);
    expect(reopened.status).toBe("DRAFT");
  });

  it("rejects a direct terminal-to-terminal jump even after reopen support is added", async () => {
    const created = await service.create(baseInput, ctx);
    await service.changeStatus(created.id, { status: "SUBMITTED" }, actorId, ctx);
    await service.changeStatus(created.id, { status: "WON" }, actorId, ctx);
    await expect(
      service.changeStatus(created.id, { status: "LOST" }, actorId, ctx),
    ).rejects.toThrow(BadRequestError);
  });

  it("notifies assignees and the creator on status change, excluding the actor", async () => {
    const created = await service.create(baseInput, ctx);
    await service.changeStatus(created.id, { status: "SUBMITTED" }, actorId, ctx);
    // actorId === createdById here, and there are no other assignees, so no notification is sent
    expect(notificationsService.createMany).not.toHaveBeenCalled();

    const otherActor = randomUUID();
    await service.changeStatus(created.id, { status: "WON" }, otherActor, ctx);
    expect(notificationsService.createMany).toHaveBeenCalledWith(
      [actorId],
      expect.objectContaining({ type: "TENDER_STATUS_CHANGED" }),
    );
  });

  it("only allows deleting a tender while it is in Draft status", async () => {
    const created = await service.create(baseInput, ctx);
    await service.changeStatus(created.id, { status: "SUBMITTED" }, actorId, ctx);
    await expect(service.delete(created.id, actorId, ctx)).rejects.toThrow(ConflictError);
  });

  it("deletes a tender in Draft status", async () => {
    const created = await service.create(baseInput, ctx);
    await service.delete(created.id, actorId, ctx);
    await expect(service.getById(created.id, BUSINESS_ID)).rejects.toThrow(NotFoundError);
  });

  it("assigns a user and sends a notification + email", async () => {
    const created = await service.create(baseInput, ctx);
    const userId = randomUUID();
    const dto = await service.addAssignee(created.id, { userId }, actorId, BUSINESS_ID);

    expect(dto.assignees).toHaveLength(1);
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId, type: "TENDER_ASSIGNED" }),
    );
    expect(emailService.queueTenderAssignedEmail).toHaveBeenCalled();
  });

  it("rejects assigning the same user twice", async () => {
    const created = await service.create(baseInput, ctx);
    const userId = randomUUID();
    await service.addAssignee(created.id, { userId }, actorId, BUSINESS_ID);
    await expect(
      service.addAssignee(created.id, { userId }, actorId, BUSINESS_ID),
    ).rejects.toThrow(ConflictError);
  });

  it("scopes dashboard stats to the caller's business", async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await service.create({ ...baseInput, submissionDate: futureDate }, ctx);

    const otherBusinessId = randomUUID();
    const otherTender = await service.create(
      { ...baseInput, tenderNumber: "TND-OTHER-BIZ", submissionDate: futureDate },
      { businessId: otherBusinessId },
    );

    const stats = await service.getDashboardStats(BUSINESS_ID);
    const otherStats = await service.getDashboardStats(otherBusinessId);

    expect(stats.totalActive).toBe(1);
    expect(stats.upcomingDeadlines.map((t) => t.id)).not.toContain(otherTender.id);
    expect(otherStats.totalActive).toBe(1);
    expect(otherStats.upcomingDeadlines.map((t) => t.id)).toContain(otherTender.id);
  });

  describe("budgetary quotations", () => {
    it("creates a budgetary quotation without requiring a tenderNumber, and doesn't dup-check it", async () => {
      const dto = await service.create(
        { ...baseInput, tenderNumber: undefined, kind: "BUDGETARY" },
        ctx,
      );
      expect(dto.kind).toBe("BUDGETARY");
    });

    it("still requires a tenderNumber and dup-checks it for a real tender", async () => {
      await service.create(baseInput, ctx);
      await expect(service.create(baseInput, ctx)).rejects.toThrow(ConflictError);
    });

    it("links a real tender to a same-client budgetary quotation", async () => {
      const budgetary = await service.create(
        { ...baseInput, tenderNumber: undefined, kind: "BUDGETARY" },
        ctx,
      );
      const real = await service.create(baseInput, ctx);

      const updated = await service.update(real.id, { convertedFromId: budgetary.id }, actorId, ctx);
      expect(updated.convertedFrom?.id).toBe(budgetary.id);
    });

    it("rejects linking to a tender that isn't a budgetary quotation", async () => {
      const otherReal = await service.create({ ...baseInput, tenderNumber: "TND-0002" }, ctx);
      const real = await service.create(baseInput, ctx);

      await expect(
        service.update(real.id, { convertedFromId: otherReal.id }, actorId, ctx),
      ).rejects.toThrow(BadRequestError);
    });

    it("rejects linking a budgetary quotation belonging to a different client", async () => {
      // Seeded directly into the fake's map rather than via service.create() — create() validates
      // clientId against FakeOrganizationsRepository, which only recognizes CLIENT_ID/
      // OTHER_CLIENT_ID, so routing an arbitrary third client through create() would throw
      // before this test ever reached update().
      const budgetary = buildTender({
        kind: "BUDGETARY",
        tenderNumber: "BQ-OTHER",
        client: { id: randomUUID(), name: "Different Client", type: "GOVERNMENT" },
      });
      tendersRepository.tenders.set(budgetary.id, budgetary);
      const real = await service.create(baseInput, ctx);

      await expect(
        service.update(real.id, { convertedFromId: budgetary.id }, actorId, ctx),
      ).rejects.toThrow(BadRequestError);
    });

    // Regression coverage: update()'s same-client check must compare against the client the
    // request is *setting* (data.clientId), not the tender's stale pre-update client — a single
    // PATCH can carry both clientId and convertedFromId at once.
    it("links to a budgetary quotation belonging to the new client, when clientId changes in the same request", async () => {
      const budgetary = await service.create(
        { ...baseInput, tenderNumber: undefined, kind: "BUDGETARY", clientId: OTHER_CLIENT_ID },
        ctx,
      );
      const real = await service.create(baseInput, ctx); // starts out on CLIENT_ID

      const updated = await service.update(
        real.id,
        { clientId: OTHER_CLIENT_ID, convertedFromId: budgetary.id },
        actorId,
        ctx,
      );
      expect(updated.convertedFrom?.id).toBe(budgetary.id);
    });

    it("rejects linking to a budgetary quotation belonging to the tender's old client, when clientId changes in the same request", async () => {
      const budgetary = await service.create(
        { ...baseInput, tenderNumber: undefined, kind: "BUDGETARY" }, // stays on CLIENT_ID
        ctx,
      );
      const real = await service.create(baseInput, ctx); // also starts out on CLIENT_ID

      await expect(
        service.update(
          real.id,
          { clientId: OTHER_CLIENT_ID, convertedFromId: budgetary.id },
          actorId,
          ctx,
        ),
      ).rejects.toThrow(BadRequestError);
    });
  });
});
