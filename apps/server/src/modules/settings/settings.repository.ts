import type { Prisma, PrismaClient } from "@bmp/database";

export interface SettingRow {
  key: string;
  value: string;
  updatedBy: { id: string; firstName: string; lastName: string } | null;
  updatedAt: Date;
}

const settingWithUpdaterArgs = {
  include: { updatedBy: { select: { id: true, firstName: true, lastName: true } } },
} satisfies Prisma.SettingDefaultArgs;

export interface ISettingsRepository {
  findAll(): Promise<SettingRow[]>;
  findByKey(key: string): Promise<SettingRow | null>;
  upsert(key: string, value: string, updatedById: string): Promise<SettingRow>;
}

export class SettingsRepository implements ISettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findAll(): Promise<SettingRow[]> {
    return this.prisma.setting.findMany(settingWithUpdaterArgs);
  }

  findByKey(key: string): Promise<SettingRow | null> {
    return this.prisma.setting.findUnique({ where: { key }, ...settingWithUpdaterArgs });
  }

  upsert(key: string, value: string, updatedById: string): Promise<SettingRow> {
    return this.prisma.setting.upsert({
      where: { key },
      create: { key, value, updatedById },
      update: { value, updatedById },
      ...settingWithUpdaterArgs,
    });
  }
}
