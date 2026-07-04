import type { Prisma, PrismaClient } from "@bmp/database";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

const userWithRole = {
  include: { role: true, avatarAttachment: true },
} satisfies Prisma.UserDefaultArgs;

export type UserWithRole = Prisma.UserGetPayload<typeof userWithRole>;

export interface CreateUserData {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  roleId: string;
  passwordHash: string;
  createdById?: string | null;
  isEmailVerified?: boolean;
}

export interface UpdateUserData {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  isActive?: boolean;
}

export interface UserFilters {
  search?: string;
  roleId?: string;
  isActive?: boolean;
}

export interface IUsersRepository {
  findById(id: string): Promise<UserWithRole | null>;
  findByEmail(email: string): Promise<UserWithRole | null>;
  findMany(
    pagination: PaginationParams,
    filters: UserFilters,
  ): Promise<{ items: UserWithRole[]; totalItems: number }>;
  create(data: CreateUserData): Promise<UserWithRole>;
  update(id: string, data: UpdateUserData): Promise<UserWithRole>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
  updateAvatarAttachmentId(id: string, avatarAttachmentId: string | null): Promise<void>;
  assignRole(id: string, roleId: string): Promise<UserWithRole>;
  updateLastLoginAt(id: string): Promise<void>;
  markEmailVerified(id: string): Promise<void>;
  countTotal(): Promise<number>;
}

export class UsersRepository implements IUsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<UserWithRole | null> {
    return this.prisma.user.findUnique({ where: { id }, ...userWithRole });
  }

  findByEmail(email: string): Promise<UserWithRole | null> {
    return this.prisma.user.findUnique({ where: { email }, ...userWithRole });
  }

  async findMany(
    pagination: PaginationParams,
    filters: UserFilters,
  ): Promise<{ items: UserWithRole[]; totalItems: number }> {
    const where: Prisma.UserWhereInput = {
      roleId: filters.roleId,
      isActive: filters.isActive,
      ...(filters.search
        ? {
            OR: [
              { email: { contains: filters.search, mode: "insensitive" } },
              { firstName: { contains: filters.search, mode: "insensitive" } },
              { lastName: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.user.findMany({
        where,
        ...userWithRole,
        orderBy: { createdAt: "desc" },
        ...toSkipTake(pagination),
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, totalItems };
  }

  create(data: CreateUserData): Promise<UserWithRole> {
    return this.prisma.user.create({
      data: {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        roleId: data.roleId,
        passwordHash: data.passwordHash,
        createdById: data.createdById,
        isEmailVerified: data.isEmailVerified ?? false,
      },
      ...userWithRole,
    });
  }

  update(id: string, data: UpdateUserData): Promise<UserWithRole> {
    return this.prisma.user.update({ where: { id }, data, ...userWithRole });
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  async updateAvatarAttachmentId(id: string, avatarAttachmentId: string | null): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { avatarAttachmentId } });
  }

  assignRole(id: string, roleId: string): Promise<UserWithRole> {
    return this.prisma.user.update({ where: { id }, data: { roleId }, ...userWithRole });
  }

  async updateLastLoginAt(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { isEmailVerified: true } });
  }

  countTotal(): Promise<number> {
    return this.prisma.user.count();
  }
}
