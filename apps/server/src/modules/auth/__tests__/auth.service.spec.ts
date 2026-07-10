import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthorizedError } from "../../../core/errors/HttpErrors.js";
import { hashPassword, sha256 } from "../../../shared/utils/hash.js";
import type { AttachmentsService } from "../../attachments/attachments.service.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { IBusinessesRepository } from "../../businesses/businesses.repository.js";
import type { IRolesRepository } from "../../roles/roles.repository.js";
import type { UserWithRole } from "../../users/users.repository.js";
import type { IUsersRepository } from "../../users/users.repository.js";
import type { CreateRefreshTokenData, IAuthRepository } from "../auth.repository.js";
import { AuthService } from "../auth.service.js";
import { TokenService } from "../token.service.js";

const BUSINESS_ID = "business-1";
const ROLE_ID = "role-admin";
const ROLE_NAME = "ADMIN";

function roleFor(roleId: string, now: Date): UserWithRole["userBusinesses"][number]["role"] {
  return {
    id: roleId,
    name: roleId === ROLE_ID ? ROLE_NAME : "VIEWER",
    description: null,
    isSystem: true,
    createdAt: now,
    updatedAt: now,
  };
}

function membershipFor(
  userId: string,
  businessId: string,
  roleId: string,
  now: Date = new Date(),
): UserWithRole["userBusinesses"][number] {
  return { id: randomUUID(), userId, businessId, roleId, role: roleFor(roleId, now), createdAt: now };
}

function buildUser(overrides: Partial<UserWithRole> = {}): UserWithRole {
  const now = new Date();
  const id = overrides.id ?? randomUUID();
  return {
    id,
    email: "jane@example.com",
    passwordHash: "",
    firstName: "Jane",
    lastName: "Doe",
    phone: null,
    isActive: true,
    isEmailVerified: true,
    lastLoginAt: null,
    createdById: null,
    avatarAttachmentId: null,
    avatarAttachment: null,
    userBusinesses: [membershipFor(id, BUSINESS_ID, ROLE_ID, now)],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as UserWithRole;
}

class FakeUsersRepository implements Partial<IUsersRepository> {
  // Stores the FULL set of a user's memberships, mirroring the real schema. Every read method
  // scopes its returned `UserWithRole` down to just the membership row for the requested
  // `businessId` — matching what `userWithRoleArgs(businessId)`'s Prisma include does.
  users = new Map<string, UserWithRole>();

  private scopedTo(user: UserWithRole, businessId: string): UserWithRole {
    return { ...user, userBusinesses: user.userBusinesses.filter((ub) => ub.businessId === businessId) };
  }

  async findByEmail(email: string, businessId: string) {
    const user = [...this.users.values()].find((u) => u.email === email);
    return user ? this.scopedTo(user, businessId) : null;
  }
  async findById(id: string, businessId: string) {
    const user = this.users.get(id);
    return user ? this.scopedTo(user, businessId) : null;
  }
  async updateLastLoginAt(id: string) {
    const user = this.users.get(id);
    if (user) user.lastLoginAt = new Date();
  }
  async updatePasswordHash(id: string, passwordHash: string) {
    const user = this.users.get(id);
    if (user) user.passwordHash = passwordHash;
  }
  async markEmailVerified(id: string) {
    const user = this.users.get(id);
    if (user) user.isEmailVerified = true;
  }
}

class FakeAuthRepository implements Partial<IAuthRepository> {
  refreshTokens = new Map<string, { id: string } & CreateRefreshTokenData & { isRevoked: boolean; replacedByTokenHash?: string }>();

  async createRefreshToken(data: CreateRefreshTokenData) {
    const id = randomUUID();
    const row = { id, ...data, isRevoked: false };
    this.refreshTokens.set(id, row);
    return row as never;
  }
  async findRefreshTokenByHash(tokenHash: string) {
    return ([...this.refreshTokens.values()].find((t) => t.tokenHash === tokenHash) as never) ?? null;
  }
  async revokeRefreshToken(id: string, replacedByTokenHash?: string) {
    const row = this.refreshTokens.get(id);
    if (row) {
      row.isRevoked = true;
      row.replacedByTokenHash = replacedByTokenHash;
    }
  }
  async revokeFamily(userId: string, family: string) {
    for (const row of this.refreshTokens.values()) {
      if (row.userId === userId && row.family === family) row.isRevoked = true;
    }
  }
  async revokeAllForUser(userId: string) {
    for (const row of this.refreshTokens.values()) {
      if (row.userId === userId) row.isRevoked = true;
    }
  }
}

class FakeBusinessesRepository implements Partial<IBusinessesRepository> {
  // userId -> businessId -> roleId
  memberships = new Map<string, Map<string, string>>();

  addMembership(userId: string, businessId: string, roleId: string) {
    if (!this.memberships.has(userId)) this.memberships.set(userId, new Map());
    this.memberships.get(userId)!.set(businessId, roleId);
  }

  async listUserBusinesses(userId: string) {
    const map = this.memberships.get(userId);
    if (!map) return [];
    return [...map.keys()].map((businessId) => ({
      businessId,
      businessName: "Acme Construction",
      businessCode: "ACME",
    }));
  }

  async findMembership(userId: string, businessId: string) {
    const roleId = this.memberships.get(userId)?.get(businessId);
    return roleId ? { roleId } : null;
  }
}

class FakeRolesRepository implements Partial<IRolesRepository> {
  roles = new Map<string, { id: string; name: string }>([[ROLE_ID, { id: ROLE_ID, name: ROLE_NAME }]]);

  async findById(id: string) {
    return (this.roles.get(id) as never) ?? null;
  }
}

describe("AuthService", () => {
  let usersRepository: FakeUsersRepository;
  let authRepository: FakeAuthRepository;
  let businessesRepository: FakeBusinessesRepository;
  let rolesRepository: FakeRolesRepository;
  let auditService: AuditService;
  let authService: AuthService;
  let user: UserWithRole;

  beforeEach(async () => {
    usersRepository = new FakeUsersRepository();
    authRepository = new FakeAuthRepository();
    businessesRepository = new FakeBusinessesRepository();
    rolesRepository = new FakeRolesRepository();
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;

    user = buildUser({ passwordHash: await hashPassword("Password123") });
    usersRepository.users.set(user.id, user);
    businessesRepository.addMembership(user.id, BUSINESS_ID, ROLE_ID);

    const fakeAttachmentsService = {} as AttachmentsService;
    const fakeEmailService = {
      queuePasswordResetEmail: vi.fn(),
      queueVerificationEmail: vi.fn(),
      queueInviteEmail: vi.fn(),
    } as never;

    authService = new AuthService(
      usersRepository as unknown as IUsersRepository,
      authRepository as unknown as IAuthRepository,
      new TokenService(),
      auditService,
      fakeAttachmentsService,
      fakeEmailService,
      businessesRepository as unknown as IBusinessesRepository,
      rolesRepository as unknown as IRolesRepository,
    );
  });

  it("logs in successfully with correct credentials", async () => {
    const result = await authService.login("jane@example.com", "Password123", {});
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.email).toBe("jane@example.com");
    expect(result.user.role.name).toBe(ROLE_NAME);
    expect(result.activeBusinessId).toBe(BUSINESS_ID);
    expect(result.availableBusinesses).toEqual([
      { businessId: BUSINESS_ID, businessName: "Acme Construction", businessCode: "ACME" },
    ]);
  });

  it("includes every membership in availableBusinesses when the user belongs to more than one business", async () => {
    const SECOND_BUSINESS_ID = "business-2";
    businessesRepository.addMembership(user.id, SECOND_BUSINESS_ID, ROLE_ID);

    const result = await authService.login("jane@example.com", "Password123", {});
    expect(result.availableBusinesses.map((b) => b.businessId).sort()).toEqual(
      [BUSINESS_ID, SECOND_BUSINESS_ID].sort(),
    );
  });

  it("rejects an incorrect password", async () => {
    await expect(authService.login("jane@example.com", "WrongPassword1", {})).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("rejects login for a deactivated account", async () => {
    user.isActive = false;
    await expect(authService.login("jane@example.com", "Password123", {})).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("rejects login for a user with no business memberships", async () => {
    businessesRepository.memberships.delete(user.id);
    await expect(authService.login("jane@example.com", "Password123", {})).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("rotates the refresh token on refresh", async () => {
    const { refreshToken } = await authService.login("jane@example.com", "Password123", {});
    const result = await authService.refresh(refreshToken, {});
    expect(result.refreshToken).not.toBe(refreshToken);
    expect(result.activeBusinessId).toBe(BUSINESS_ID);
    expect(result.availableBusinesses).toEqual([
      { businessId: BUSINESS_ID, businessName: "Acme Construction", businessCode: "ACME" },
    ]);

    const oldRow = [...authRepository.refreshTokens.values()].find(
      (t) => t.tokenHash === sha256(refreshToken),
    );
    expect(oldRow?.isRevoked).toBe(true);
  });

  it("carries the same activeBusinessId forward when rotating the refresh token", async () => {
    const { refreshToken } = await authService.login("jane@example.com", "Password123", {});
    await authService.refresh(refreshToken, {});

    const rows = [...authRepository.refreshTokens.values()];
    expect(rows.every((row) => row.activeBusinessId === BUSINESS_ID)).toBe(true);
  });

  it("detects refresh token reuse and revokes the whole family", async () => {
    const { refreshToken } = await authService.login("jane@example.com", "Password123", {});
    await authService.refresh(refreshToken, {});

    // Replaying the already-rotated (now revoked) token must fail and nuke the family.
    await expect(authService.refresh(refreshToken, {})).rejects.toThrow(UnauthorizedError);

    const allRevoked = [...authRepository.refreshTokens.values()]
      .filter((t) => t.userId === user.id)
      .every((t) => t.isRevoked);
    expect(allRevoked).toBe(true);
  });

  it("returns activeBusinessId and availableBusinesses when switching business", async () => {
    const SECOND_BUSINESS_ID = "business-2";
    businessesRepository.addMembership(user.id, SECOND_BUSINESS_ID, ROLE_ID);

    const result = await authService.switchBusiness(user.id, SECOND_BUSINESS_ID, {});
    expect(result.activeBusinessId).toBe(SECOND_BUSINESS_ID);
    expect(result.availableBusinesses.map((b) => b.businessId).sort()).toEqual(
      [BUSINESS_ID, SECOND_BUSINESS_ID].sort(),
    );
  });
});

describe("AuthService.switchBusiness", () => {
  it("throws ForbiddenError when the user has no membership in the target business", async () => {
    const businessesRepository = {
      findMembership: vi.fn().mockResolvedValue(null),
      listUserBusinesses: vi.fn(),
    };
    const service = new AuthService(
      {} as never, // usersRepository
      {} as never, // authRepository
      {} as never, // tokenService
      { log: vi.fn() } as never, // auditService
      {} as never, // attachmentsService
      {} as never, // emailService
      businessesRepository as never,
      {} as never, // rolesRepository
    );
    await expect(service.switchBusiness("user-1", "business-2")).rejects.toThrow(
      "You do not have access to this business",
    );
    expect(businessesRepository.findMembership).toHaveBeenCalledWith("user-1", "business-2");
    expect(businessesRepository.listUserBusinesses).not.toHaveBeenCalled();
  });
});
