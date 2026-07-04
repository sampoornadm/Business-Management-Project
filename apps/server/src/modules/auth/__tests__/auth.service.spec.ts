import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnauthorizedError } from "../../../core/errors/HttpErrors.js";
import { hashPassword, sha256 } from "../../../shared/utils/hash.js";
import type { AttachmentsService } from "../../attachments/attachments.service.js";
import type { AuditService } from "../../audit/audit.service.js";
import type { UserWithRole } from "../../users/users.repository.js";
import type { IUsersRepository } from "../../users/users.repository.js";
import type { CreateRefreshTokenData, IAuthRepository } from "../auth.repository.js";
import { AuthService } from "../auth.service.js";
import { TokenService } from "../token.service.js";

function buildUser(overrides: Partial<UserWithRole> = {}): UserWithRole {
  const now = new Date();
  return {
    id: randomUUID(),
    email: "jane@example.com",
    passwordHash: "",
    firstName: "Jane",
    lastName: "Doe",
    phone: null,
    isActive: true,
    isEmailVerified: true,
    lastLoginAt: null,
    createdById: null,
    roleId: "role-admin",
    avatarAttachmentId: null,
    avatarAttachment: null,
    role: { id: "role-admin", name: "ADMIN", description: null, isSystem: true, createdAt: now, updatedAt: now },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as UserWithRole;
}

class FakeUsersRepository implements Partial<IUsersRepository> {
  users = new Map<string, UserWithRole>();

  async findByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async findById(id: string) {
    return this.users.get(id) ?? null;
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

describe("AuthService", () => {
  let usersRepository: FakeUsersRepository;
  let authRepository: FakeAuthRepository;
  let auditService: AuditService;
  let authService: AuthService;
  let user: UserWithRole;

  beforeEach(async () => {
    usersRepository = new FakeUsersRepository();
    authRepository = new FakeAuthRepository();
    auditService = { log: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;

    user = buildUser({ passwordHash: await hashPassword("Password123") });
    usersRepository.users.set(user.id, user);

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
    );
  });

  it("logs in successfully with correct credentials", async () => {
    const result = await authService.login("jane@example.com", "Password123", {});
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.email).toBe("jane@example.com");
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

  it("rotates the refresh token on refresh", async () => {
    const { refreshToken } = await authService.login("jane@example.com", "Password123", {});
    const result = await authService.refresh(refreshToken, {});
    expect(result.refreshToken).not.toBe(refreshToken);

    const oldRow = [...authRepository.refreshTokens.values()].find(
      (t) => t.tokenHash === sha256(refreshToken),
    );
    expect(oldRow?.isRevoked).toBe(true);
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
});
