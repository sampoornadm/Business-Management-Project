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

  async findLatestEntityCode(entityType: string, entityId: string) {
    return [...this.created].reverse().find((r) => r.entityType === entityType && r.entityId === entityId && r.entityCode)
      ?.entityCode ?? null;
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

  it("falls back to the entity's last known code once it is deleted", async () => {
    const repository = new FakeAuditRepository();
    const resolve = vi.fn().mockResolvedValueOnce("Acme Traders").mockResolvedValueOnce(null);
    const service = new AuditService(repository, resolve);
    await service.log({ action: "VENDOR_CREATED", entityType: "Vendor", entityId: "v-1" });

    await service.log({ action: "VENDOR_DELETED", entityType: "Vendor", entityId: "v-1" });

    expect(repository.created[1]!.entityCode).toBe("Acme Traders");
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
