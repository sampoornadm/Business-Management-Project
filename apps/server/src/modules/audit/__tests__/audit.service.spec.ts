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

  async findLatestEntityRef(entityType: string, entityId: string) {
    const row = [...this.created].reverse().find((r) => r.entityType === entityType && r.entityId === entityId && r.entityCode);
    return row ? { code: row.entityCode ?? null, businessId: row.businessId ?? null } : null;
  }
}

describe("AuditService.log entity codes", () => {
  it("stores the resolved entity code", async () => {
    const repository = new FakeAuditRepository();
    const resolve = vi.fn().mockResolvedValue({ code: "TND-0042", businessId: "biz-1" });
    const service = new AuditService(repository, resolve);

    await service.log({ action: "TENDER_UPDATED", entityType: "Tender", entityId: "t-1" });

    expect(resolve).toHaveBeenCalledWith("Tender", "t-1");
    expect(repository.created[0]!.entityCode).toBe("TND-0042");
    expect(repository.created[0]!.businessId).toBe("biz-1");
  });

  it("keeps an explicitly passed entityCode and still resolves the business", async () => {
    const repository = new FakeAuditRepository();
    const resolve = vi.fn().mockResolvedValue({ code: "ignored", businessId: "biz-1" });
    const service = new AuditService(repository, resolve);

    await service.log({ action: "TENDER_UPDATED", entityType: "Tender", entityId: "t-1", entityCode: "TND-9" });

    expect(repository.created[0]).toMatchObject({ entityCode: "TND-9", businessId: "biz-1" });
  });

  it("skips the lookup when both entityCode and businessId are passed", async () => {
    const repository = new FakeAuditRepository();
    const resolve = vi.fn();
    const service = new AuditService(repository, resolve);

    await service.log({ action: "TENDER_DELETED", entityType: "Tender", entityId: "t-1", entityCode: "TND-9", businessId: "biz-1" });

    expect(resolve).not.toHaveBeenCalled();
    expect(repository.created[0]).toMatchObject({ entityCode: "TND-9", businessId: "biz-1" });
  });

  it("falls back to the entity's last known code once it is deleted", async () => {
    const repository = new FakeAuditRepository();
    const resolve = vi.fn().mockResolvedValueOnce({ code: "Acme Traders", businessId: "biz-1" }).mockResolvedValueOnce(null);
    const service = new AuditService(repository, resolve);
    await service.log({ action: "VENDOR_CREATED", entityType: "Vendor", entityId: "v-1" });

    await service.log({ action: "VENDOR_DELETED", entityType: "Vendor", entityId: "v-1" });

    expect(repository.created[1]!.entityCode).toBe("Acme Traders");
    expect(repository.created[1]!.businessId).toBe("biz-1");
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
