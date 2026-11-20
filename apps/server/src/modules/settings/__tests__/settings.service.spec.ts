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

  async delete(key: string): Promise<void> {
    this.rows.delete(key);
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

  describe("prompt settings", () => {
    it("refuses a prompt missing a required marker, naming the missing ones", async () => {
      const attempt = service.set("PROMPT_RFQ_QUOTE_PASTE", "no markers here", actorId);
      await expect(attempt).rejects.toThrow(BadRequestError);
      await expect(service.set("PROMPT_RFQ_QUOTE_PASTE", "no markers here", actorId)).rejects.toThrow(
        /\{\{items\}\}.*\{\{lines\}\}/,
      );
      expect(repository.rows.has("PROMPT_RFQ_QUOTE_PASTE")).toBe(false);
    });

    it("stores a prompt that keeps every marker", async () => {
      await service.set("PROMPT_RFQ_QUOTE_PASTE", "Items {{items}} Lines {{lines}}", actorId);
      expect(await service.get<string>("PROMPT_RFQ_QUOTE_PASTE")).toBe("Items {{items}} Lines {{lines}}");
    });

    it("reset deletes the override, audits it, and returns the default", async () => {
      await service.set("PROMPT_RFQ_QUOTE_PASTE", "Items {{items}} Lines {{lines}}", actorId);
      const dto = await service.reset("PROMPT_RFQ_QUOTE_PASTE", actorId);

      expect(repository.rows.has("PROMPT_RFQ_QUOTE_PASTE")).toBe(false);
      expect(dto.isOverridden).toBe(false);
      expect(dto.value).toBe(dto.defaultValue);
      expect(auditLog).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: "SETTING_RESET", entityType: "Setting", entityId: "PROMPT_RFQ_QUOTE_PASTE" }),
      );
    });

    it("exposes required markers and the prompt type in the DTO", async () => {
      const dto = (await service.listAll()).find((s) => s.key === "PROMPT_RFQ_QUOTE_PASTE")!;
      expect(dto.type).toBe("prompt");
      expect(dto.group).toBe("AI prompts");
      expect(dto.requiredMarkers).toEqual(["items", "lines"]);
    });
  });
});
