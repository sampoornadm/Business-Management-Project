import type { Permission, PrismaClient } from "@bmp/database";

export interface IPermissionsRepository {
  findAll(): Promise<Permission[]>;
}

export class PermissionsRepository implements IPermissionsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findAll(): Promise<Permission[]> {
    return this.prisma.permission.findMany({ orderBy: [{ resource: "asc" }, { action: "asc" }] });
  }
}
