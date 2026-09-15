import type { Prisma, PrismaClient } from "@bmp/database";
import type { FilterCondition, UserSortField } from "@bmp/types";

import type { PaginationParams } from "../../core/interfaces/pagination.js";
import { buildPrismaFilterWhere } from "../../shared/utils/filtering.js";
import { toSkipTake } from "../../shared/utils/pagination.js";

import { USER_FILTER_COLUMNS, USER_SORT_COLUMNS } from "./users.filter-columns.js";

function userWithRoleArgs(businessId: string) {
  return {
    include: {
      avatarAttachment: true,
      userBusinesses: { where: { businessId }, include: { role: true } },
    },
  } satisfies Prisma.UserDefaultArgs;
}

export type UserWithRole = Prisma.UserGetPayload<ReturnType<typeof userWithRoleArgs>>;

export interface CreateUserData {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  businessId: string;
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
  businessId: string;
  search?: string;
  roleId?: string;
  isActive?: boolean;
  filters?: FilterCondition[];
  sortBy?: UserSortField;
  sortDir?: "asc" | "desc";
}

export interface IUsersRepository {
  findById(id: string, businessId: string): Promise<UserWithRole | null>;
  findByEmail(email: string, businessId: string): Promise<UserWithRole | null>;
  findMany(
    pagination: PaginationParams,
    filters: UserFilters,
  ): Promise<{ items: UserWithRole[]; totalItems: number }>;
  create(data: CreateUserData): Promise<UserWithRole>;
  update(id: string, data: UpdateUserData, businessId: string): Promise<UserWithRole>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
  updateAvatarAttachmentId(id: string, avatarAttachmentId: string | null): Promise<void>;
  assignRole(id: string, businessId: string, roleId: string): Promise<UserWithRole>;
  updateThemeColor(id: string, businessId: string, themeColor: string): Promise<UserWithRole>;
  updateLastLoginAt(id: string): Promise<void>;
  markEmailVerified(id: string): Promise<void>;
  countTotal(businessId: string): Promise<number>;
}

export class UsersRepository implements IUsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string, businessId: string): Promise<UserWithRole | null> {
    return this.prisma.user.findUnique({ where: { id }, ...userWithRoleArgs(businessId) });
  }

  findByEmail(email: string, businessId: string): Promise<UserWithRole | null> {
    return this.prisma.user.findUnique({ where: { email }, ...userWithRoleArgs(businessId) });
  }

  async findMany(
    pagination: PaginationParams,
    filters: UserFilters,
  ): Promise<{ items: UserWithRole[]; totalItems: number }> {
    // "role" is pulled out and merged into the SAME userBusinesses.some(...) block as
    // businessId below, rather than AND'd in as an independent chip clause. Role is a global
    // table (packages/database/prisma/schema.prisma's Role.name is @unique, not scoped per
    // business), so a user with different roles in different businesses has multiple
    // UserBusiness rows sharing the relation — two separate `some` filters (one for businessId,
    // one for roleId) would each only need SOME row to match, which could be two DIFFERENT rows,
    // incorrectly matching a user who doesn't actually hold that role in this business.
    // buildPrismaFilterWhere with a single-segment prismaPath here just builds the
    // `{ roleId: {...} }` fragment; it's spread into the shared `some` object, never AND'd.
    const roleCondition = (filters.filters ?? []).find((f) => f.columnKey === "role");
    const otherFilters = (filters.filters ?? []).filter((f) => f.columnKey !== "role");
    const roleWhereFragment = roleCondition
      ? (buildPrismaFilterWhere([roleCondition], {
          role: { type: "enum", prismaPath: ["roleId"] },
        }) as Pick<Prisma.UserBusinessWhereInput, "roleId">)
      : {};

    const baseWhere: Prisma.UserWhereInput = {
      userBusinesses: {
        some: {
          businessId: filters.businessId,
          ...(filters.roleId ? { roleId: filters.roleId } : {}),
          ...roleWhereFragment,
        },
      },
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

    const chipWhere = buildPrismaFilterWhere(otherFilters, USER_FILTER_COLUMNS) as Prisma.UserWhereInput;
    const where: Prisma.UserWhereInput =
      Object.keys(chipWhere).length > 0 ? { AND: [baseWhere, chipWhere] } : baseWhere;

    const orderBy = filters.sortBy
      ? USER_SORT_COLUMNS[filters.sortBy](filters.sortDir ?? "asc")
      : ({ createdAt: "desc" } as const);

    const [items, totalItems] = await Promise.all([
      this.prisma.user.findMany({
        where,
        ...userWithRoleArgs(filters.businessId),
        orderBy,
        ...toSkipTake(pagination),
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, totalItems };
  }

  async create(data: CreateUserData): Promise<UserWithRole> {
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        passwordHash: data.passwordHash,
        createdById: data.createdById,
        isEmailVerified: data.isEmailVerified ?? false,
        userBusinesses: {
          create: { businessId: data.businessId, roleId: data.roleId },
        },
      },
    });
    return this.findById(user.id, data.businessId) as Promise<UserWithRole>;
  }

  async update(id: string, data: UpdateUserData, businessId: string): Promise<UserWithRole> {
    // update() doesn't change role/business, but the returned include still needs to be scoped
    // to the caller's businessId — a user with memberships in multiple businesses must never
    // have this resolve to a different business's role than the one the request is scoped to.
    const updated = await this.prisma.user.update({ where: { id }, data });
    return this.findById(updated.id, businessId) as Promise<UserWithRole>;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  async updateAvatarAttachmentId(id: string, avatarAttachmentId: string | null): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { avatarAttachmentId } });
  }

  async assignRole(id: string, businessId: string, roleId: string): Promise<UserWithRole> {
    await this.prisma.userBusiness.upsert({
      where: { userId_businessId: { userId: id, businessId } },
      update: { roleId },
      create: { userId: id, businessId, roleId },
    });
    return this.findById(id, businessId) as Promise<UserWithRole>;
  }

  async updateThemeColor(
    id: string,
    businessId: string,
    themeColor: string,
  ): Promise<UserWithRole> {
    await this.prisma.userBusiness.update({
      where: { userId_businessId: { userId: id, businessId } },
      data: { themeColor },
    });
    return this.findById(id, businessId) as Promise<UserWithRole>;
  }

  async updateLastLoginAt(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { isEmailVerified: true } });
  }

  countTotal(businessId: string): Promise<number> {
    return this.prisma.user.count({ where: { userBusinesses: { some: { businessId } } } });
  }
}
