import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BadRequestError } from "../../../core/errors/HttpErrors.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { ISettingsRepository, SettingRow } from "../settings.repository.js";
import { SettingsService } from "../settings.service.js";

class FakeSettingsRepository implements ISettingsRepository {
  rows = new Map<string, SettingRow>();

  async findAll(): Promise<SettingRow[]> {
    return [...this.rows.values()];
  }

  async findByKey(key: string): Promise<SettingRow | null> {
    return this.rows.get(key) ?? null;
  }

  async upsert(key: string, value: string, updatedById: string): Promise<SettingRow> {
    const row: SettingRow = {
      key,
      value,
      updatedBy: { id: updatedById, firstName: "Super", lastName: "Admin" },
      updatedAt: new Date(),
    };
    this.rows.set(key, row);
    return row;
  }
}

describe("SettingsService", () => {
  let repository: FakeSettingsRepository;
  let auditLog: ReturnType<typeof vi.fn>;
  let service: SettingsService;
  const actorId = randomUUID();

  beforeEach(() => {
    repository = new FakeSettingsRepository();
    auditLog = vi.fn().mockResolvedValue(undefined);
    service = new SettingsService(repository, { log: auditLog } as unknown as AuditService);
  });

  it("falls back to the env-derived default when no row exists", async () => {
    const value = await service.get<number>("AI_MATCH_THRESHOLD");
    expect(value).toBe(0.98);
  });

  it("returns the stored value once set, and audit-logs the write", async () => {
    await service.set("AI_MATCH_THRESHOLD", 0.95, actorId);

    const value = await service.get<number>("AI_MATCH_THRESHOLD");
    expect(value).toBe(0.95);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId,
        action: "SETTING_UPDATED",
        entityType: "Setting",
        entityId: "AI_MATCH_THRESHOLD",
        metadata: { key: "AI_MATCH_THRESHOLD", value: 0.95 },
      }),
    );
  });

  it("rejects a non-number value for a number-typed setting", async () => {
    await expect(
      service.set("AI_MATCH_THRESHOLD", "not-a-number" as unknown as number, actorId),
    ).rejects.toThrow(BadRequestError);
  });

  it("lists every setting key, overridden or not", async () => {
    await service.set("HSN_SAC_AUTO_REFRESH_ENABLED", false, actorId);

    const all = await service.listAll();
    const overridden = all.find((s) => s.key === "HSN_SAC_AUTO_REFRESH_ENABLED")!;
    const notOverridden = all.find((s) => s.key === "AI_CONTEXT_FLOOR")!;

    expect(overridden.value).toBe(false);
    expect(overridden.isOverridden).toBe(true);
    expect(notOverridden.value).toBe(0.75);
    expect(notOverridden.isOverridden).toBe(false);
  });
});
