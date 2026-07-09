import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { BadRequestError, ConflictError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { AttachmentsService } from "../../attachments/attachments.service.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { IAuthRepository } from "../../auth/auth.repository.js";
import type { IRolesRepository } from "../../roles/roles.repository.js";
import type { CreateUserData, IUsersRepository, UpdateUserData, UserWithRole } from "../users.repository.js";
import { UsersService } from "../users.service.js";

const ROLE_NAMES_BY_ID: Record<string, string> = {
  "role-admin": "ADMIN",
  "role-viewer": "VIEWER",
};

const BUSINESS_ID = "business-1";

function roleFor(roleId: string, now: Date): UserWithRole["userBusinesses"][number]["role"] {
  return {
    id: roleId,
    name: ROLE_NAMES_BY_ID[roleId] ?? "VIEWER",
    description: null,
    isSystem: true,
    createdAt: now,
    updatedAt: now,
  };
}

function buildUser(
  overrides: Partial<UserWithRole> & { roleId?: string; businessId?: string } = {},
): UserWithRole {
  const now = new Date();
  const roleId = overrides.roleId ?? "role-viewer";
  const businessId = overrides.businessId ?? BUSINESS_ID;
  const id = overrides.id ?? randomUUID();
  return {
    id,
    email: "existing@example.com",
    passwordHash: "hash",
    firstName: "Existing",
    lastName: "User",
    phone: null,
    isActive: true,
    isEmailVerified: true,
    lastLoginAt: null,
    createdById: null,
    avatarAttachmentId: null,
    avatarAttachment: null,
    userBusinesses: [
      {
        id: randomUUID(),
        userId: id,
        businessId,
        roleId,
        role: roleFor(roleId, now),
        createdAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as UserWithRole;
}

class FakeUsersRepository implements Partial<IUsersRepository> {
  users = new Map<string, UserWithRole>();

  async findByEmail(email: string, _businessId: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async findById(id: string, _businessId: string) {
    return this.users.get(id) ?? null;
  }
  async create(data: CreateUserData) {
    const now = new Date();
    const user = buildUser({
      id: randomUUID(),
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      roleId: data.roleId,
      businessId: data.businessId,
      passwordHash: data.passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    this.users.set(user.id, user);
    return user;
  }
  async update(id: string, data: UpdateUserData) {
    const user = this.users.get(id);
    if (!user) throw new Error("not found");
    Object.assign(user, data);
    return user;
  }
  async assignRole(id: string, businessId: string, roleId: string) {
    const user = this.users.get(id);
    if (!user) throw new Error("not found");
    user.userBusinesses = [
      {
        id: randomUUID(),
        userId: id,
        businessId,
        roleId,
        role: roleFor(roleId, new Date()),
        createdAt: new Date(),
      },
    ];
    return user;
  }
}

class FakeRolesRepository implements Partial<IRolesRepository> {
  roles = new Map<string, { id: string; name: string }>([
    ["role-admin", { id: "role-admin", name: "ADMIN" }],
    ["role-viewer", { id: "role-viewer", name: "VIEWER" }],
  ]);

  async findById(id: string) {
    return (this.roles.get(id) as never) ?? null;
  }
}

describe("UsersService", () => {
  let usersRepository: FakeUsersRepository;
  let rolesRepository: FakeRolesRepository;
  let auditService: AuditService;
  let usersService: UsersService;
  let existing: UserWithRole;

  beforeEach(() => {
    usersRepository = new FakeUsersRepository();
    rolesRepository = new FakeRolesRepository();
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    existing = buildUser();
    usersRepository.users.set(existing.id, existing);

    const fakeAuthRepository = {
      createPasswordResetToken: vi.fn().mockResolvedValue(undefined),
      revokeAllForUser: vi.fn().mockResolvedValue(undefined),
    } as unknown as IAuthRepository;
    const fakeAttachmentsService = { getVariants: vi.fn().mockResolvedValue([]) } as unknown as AttachmentsService;
    const fakeEmailService = { queueInviteEmail: vi.fn().mockResolvedValue(undefined) } as never;

    usersService = new UsersService(
      usersRepository as unknown as IUsersRepository,
      rolesRepository as unknown as IRolesRepository,
      fakeAuthRepository,
      auditService,
      fakeAttachmentsService,
      fakeEmailService,
    );
  });

  it("creates a user and queues an invite email", async () => {
    const dto = await usersService.createUser(
      { email: "new@example.com", firstName: "New", lastName: "Person", roleId: "role-admin" },
      existing.id,
      BUSINESS_ID,
    );
    expect(dto.email).toBe("new@example.com");
    expect(dto.role.name).toBe("ADMIN");
  });

  it("rejects creating a user with a duplicate email", async () => {
    await expect(
      usersService.createUser(
        { email: existing.email, firstName: "Dup", lastName: "User", roleId: "role-admin" },
        existing.id,
        BUSINESS_ID,
      ),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects creating a user with an unknown role", async () => {
    await expect(
      usersService.createUser(
        { email: "another@example.com", firstName: "A", lastName: "B", roleId: "role-unknown" },
        existing.id,
        BUSINESS_ID,
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it("throws NotFoundError when assigning a role to a missing user", async () => {
    await expect(
      usersService.assignRole(randomUUID(), "role-admin", existing.id, BUSINESS_ID),
    ).rejects.toThrow(NotFoundError);
  });

  it("assigns a valid role to an existing user", async () => {
    const dto = await usersService.assignRole(existing.id, "role-admin", existing.id, BUSINESS_ID);
    expect(dto.role.name).toBe("ADMIN");
  });
});
