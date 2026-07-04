import type { Prisma, PrismaClient, Role } from "@bmp/database";

const roleWithPermissions = {
  include: { rolePermissions: { include: { permission: true } } },
} satisfies Prisma.RoleDefaultArgs;

export type RoleWithPermissions = Prisma.RoleGetPayload<typeof roleWithPermissions>;

export interface IRolesRepository {
  findById(id: string): Promise<Role | null>;
  findByName(name: string): Promise<Role | null>;
  findAllWithPermissions(): Promise<RoleWithPermissions[]>;
}

export class RolesRepository implements IRolesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<Role | null> {
    return this.prisma.role.findUnique({ where: { id } });
  }

  findByName(name: string): Promise<Role | null> {
    return this.prisma.role.findUnique({ where: { name } });
  }

  findAllWithPermissions(): Promise<RoleWithPermissions[]> {
    return this.prisma.role.findMany({
      ...roleWithPermissions,
      orderBy: { name: "asc" },
    });
  }
}
