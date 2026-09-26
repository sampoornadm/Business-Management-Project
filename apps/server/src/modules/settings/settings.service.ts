import type { SettingDto, SettingKey } from "@bmp/types";
import { SETTING_KEYS } from "@bmp/types";

import { BadRequestError } from "../../core/errors/HttpErrors.js";
import type { AuditService } from "../audit/audit.service.js";

import { SETTING_DEFINITIONS } from "./settings.registry.js";
import type { ISettingsRepository, SettingRow } from "./settings.repository.js";

function parseValue(raw: string, type: "string" | "number" | "boolean"): string | number | boolean {
  if (type === "boolean") return raw === "true";
  if (type === "number") return Number(raw);
  return raw;
}

function serializeValue(value: string | number | boolean): string {
  return String(value);
}

function toDto(key: SettingKey, row: SettingRow | null): SettingDto {
  const def = SETTING_DEFINITIONS[key];
  return {
    key,
    type: def.type,
    label: def.label,
    group: def.group,
    value: row ? parseValue(row.value, def.type) : def.defaultValue,
    isOverridden: row !== null,
    updatedByName: row?.updatedBy ? `${row.updatedBy.firstName} ${row.updatedBy.lastName}` : null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

export class SettingsService {
  constructor(
    private readonly settingsRepository: ISettingsRepository,
    private readonly auditService: AuditService,
  ) {}

  async listAll(): Promise<SettingDto[]> {
    const rows = await this.settingsRepository.findAll();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return SETTING_KEYS.map((key) => toDto(key, byKey.get(key) ?? null));
  }

  /** Typed read for server-side callers — falls back to the env-derived default. */
  async get<T extends string | number | boolean>(key: SettingKey): Promise<T> {
    const row = await this.settingsRepository.findByKey(key);
    const def = SETTING_DEFINITIONS[key];
    return (row ? parseValue(row.value, def.type) : def.defaultValue) as T;
  }

  async set(key: SettingKey, value: string | number | boolean, actorId: string): Promise<SettingDto> {
    const def = SETTING_DEFINITIONS[key];
    if (def.type === "number" && (typeof value !== "number" || Number.isNaN(value))) {
      throw new BadRequestError(`${key} must be a number`);
    }
    if (def.type === "boolean" && typeof value !== "boolean") {
      throw new BadRequestError(`${key} must be a boolean`);
    }
    if (def.type === "string" && typeof value !== "string") {
      throw new BadRequestError(`${key} must be a string`);
    }
    const row = await this.settingsRepository.upsert(key, serializeValue(value), actorId);
    await this.auditService.log({
      actorId,
      action: "SETTING_UPDATED",
      entityType: "Setting",
      entityId: key,
      metadata: { key, value },
    });
    return toDto(key, row);
  }
}
