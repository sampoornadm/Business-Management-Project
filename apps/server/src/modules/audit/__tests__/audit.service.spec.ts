import { describe, expect, it, vi } from "vitest";

import type { CreateAuditLogData, IAuditRepository } from "../audit.repository.js";
import { AuditService } from "../audit.service.js";

class FakeAuditRepository implements IAuditRepository {
  created: CreateAuditLogData[] = [];

  async create(data: CreateAuditLogData) {
    this.created.push(data);
  }

  async findMany() {
    return { items: [], totalItems: 0 };
  }
}

describe("AuditService.log entity codes", () => {
  it("stores the resolved entity code", async () => {
    const repository = new FakeAuditRepository();
    const resolve = vi.fn().mockResolvedValue("TND-0042");
    const service = new AuditService(repository, resolve);

    await service.log({ action: "TENDER_UPDATED", entityType: "Tender", entityId: "t-1" });

    expect(resolve).toHaveBeenCalledWith("Tender", "t-1");
    expect(repository.created[0]!.entityCode).toBe("TND-0042");
  });

  it("keeps an explicitly passed entityCode without resolving", async () => {
    const repository = new FakeAuditRepository();
    const resolve = vi.fn();
    const service = new AuditService(repository, resolve);

    await service.log({ action: "TENDER_DELETED", entityType: "Tender", entityId: "t-1", entityCode: "TND-9" });

    expect(resolve).not.toHaveBeenCalled();
    expect(repository.created[0]!.entityCode).toBe("TND-9");
  });

  it("stores null when the resolver throws", async () => {
    const repository = new FakeAuditRepository();
    const service = new AuditService(repository, vi.fn().mockRejectedValue(new Error("db down")));

    await service.log({ action: "TENDER_UPDATED", entityType: "Tender", entityId: "t-1" });

    expect(repository.created[0]!.entityCode).toBeNull();
  });

  it("stores null without resolving when the row names no entity", async () => {
    const repository = new FakeAuditRepository();
    const resolve = vi.fn();
    const service = new AuditService(repository, resolve);

    await service.log({ action: "USER_LOGIN" });

    expect(resolve).not.toHaveBeenCalled();
    expect(repository.created[0]!.entityCode).toBeNull();
  });
});
