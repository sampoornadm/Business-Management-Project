import type { AvailableBusiness, LoginResponseDto, SessionDto, UserDto } from "@bmp/types";

import { env } from "../../config/env.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../../core/errors/HttpErrors.js";
import type { RequestContext } from "../../core/interfaces/request-context.js";
import type { EmailService } from "../../infra/mailer/email.service.js";
import { comparePassword, hashPassword, sha256 } from "../../shared/utils/hash.js";
import { generateOpaqueToken, generateTokenFamily } from "../../shared/utils/tokens.js";
import type { AttachmentsService } from "../attachments/attachments.service.js";
import type { AuditService } from "../audit/audit.service.js";
import type { IBusinessesRepository } from "../businesses/businesses.repository.js";
import type { IRolesRepository } from "../roles/roles.repository.js";
import { toUserDto } from "../users/users.mapper.js";
import type { IUsersRepository } from "../users/users.repository.js";

import type { IAuthRepository } from "./auth.repository.js";
import type { TokenService } from "./token.service.js";

export interface LoginResult extends LoginResponseDto {
  refreshToken: string;
}

export interface RefreshResult {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  activeBusinessId: string;
  availableBusinesses: AvailableBusiness[];
}

interface ActiveBusiness {
  businessId: string;
  roleId: string;
  roleName: string;
  availableBusinesses: AvailableBusiness[];
}

// usersRepository.findByEmail/findById take a businessId only to scope which UserBusiness
// membership row gets attached to the result (`userBusinesses: [...]`) — it has no bearing on
// which User row is found. The handful of call sites below (forgotPassword/resendVerification/
// changePassword) never read `user.userBusinesses`/`role`, so there is no real business to scope
// to yet; this placeholder is passed purely to satisfy the (business-scoped) repository signature.
const NO_BUSINESS_CONTEXT = "";

export class AuthService {
  constructor(
    private readonly usersRepository: IUsersRepository,
    private readonly authRepository: IAuthRepository,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
    private readonly attachmentsService: AttachmentsService,
    private readonly emailService: EmailService,
    private readonly businessesRepository: IBusinessesRepository,
    private readonly rolesRepository: IRolesRepository,
  ) {}

  private toDto(user: Parameters<typeof toUserDto>[0]): Promise<UserDto> {
    return toUserDto(user, this.attachmentsService);
  }

  /**
   * Resolves which business a user's new session should be active in. Picks `preferredBusinessId`
   * when the user still has a membership there, otherwise falls back to their first membership.
   * Throws if the user has no business memberships at all.
   */
  private async resolveActiveBusiness(
    userId: string,
    preferredBusinessId?: string,
  ): Promise<ActiveBusiness> {
    const memberships = await this.businessesRepository.listUserBusinesses(userId);
    if (memberships.length === 0) {
      throw new UnauthorizedError("This account is not assigned to any business");
    }
    const chosen =
      memberships.find((m) => m.businessId === preferredBusinessId) ?? memberships[0]!;
    const membership = await this.businessesRepository.findMembership(userId, chosen.businessId);
    const role = await this.rolesRepository.findById(membership!.roleId);
    return {
      businessId: chosen.businessId,
      roleId: membership!.roleId,
      roleName: role!.name,
      availableBusinesses: memberships,
    };
  }

  private async issueRefreshToken(
    userId: string,
    businessId: string,
    family: string,
    context: RequestContext,
  ): Promise<string> {
    const rawToken = generateOpaqueToken();
    await this.authRepository.createRefreshToken({
      userId,
      activeBusinessId: businessId,
      tokenHash: sha256(rawToken),
      family,
      deviceInfo: context.userAgent ?? null,
      ipAddress: context.ipAddress ?? null,
      expiresAt: this.tokenService.getRefreshTokenExpiry(),
    });
    return rawToken;
  }

  async login(email: string, password: string, context: RequestContext): Promise<LoginResult> {
    const user = await this.usersRepository.findByEmail(email, NO_BUSINESS_CONTEXT);

    if (!user || !(await comparePassword(password, user.passwordHash))) {
      await this.auditService.log({
        actorId: user?.id ?? null,
        action: "AUTH_LOGIN_FAILURE",
        entityType: "User",
        entityId: user?.id,
        metadata: { email },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedError("Invalid email or password");
    }

    if (!user.isActive) {
      throw new UnauthorizedError("This account has been deactivated");
    }

    const active = await this.resolveActiveBusiness(user.id);
    // Re-fetch scoped to the resolved business so the returned DTO's `role` reflects the
    // membership that's actually active for this session, not an empty/arbitrary one.
    const scopedUser = await this.usersRepository.findById(user.id, active.businessId);
    if (!scopedUser) throw new UnauthorizedError("Account is not active");

    const family = generateTokenFamily();
    const refreshToken = await this.issueRefreshToken(user.id, active.businessId, family, context);
    const { token: accessToken, expiresAt } = this.tokenService.signAccessToken({
      sub: user.id,
      roleId: active.roleId,
      roleName: active.roleName,
      businessId: active.businessId,
    });

    await this.usersRepository.updateLastLoginAt(user.id);
    await this.auditService.log({
      actorId: user.id,
      action: "AUTH_LOGIN_SUCCESS",
      entityType: "User",
      entityId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return {
      accessToken,
      accessTokenExpiresAt: expiresAt.toISOString(),
      user: await this.toDto(scopedUser),
      refreshToken,
      activeBusinessId: active.businessId,
      availableBusinesses: active.availableBusinesses,
    };
  }

  async refresh(rawToken: string, context: RequestContext): Promise<RefreshResult> {
    const tokenHash = sha256(rawToken);
    const existing = await this.authRepository.findRefreshTokenByHash(tokenHash);

    if (!existing) throw new UnauthorizedError("Invalid refresh token");

    if (existing.isRevoked) {
      await this.authRepository.revokeFamily(existing.userId, existing.family);
      await this.auditService.log({
        actorId: existing.userId,
        action: "AUTH_TOKEN_REUSE_DETECTED",
        entityType: "User",
        entityId: existing.userId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedError("Refresh token has already been used; all sessions revoked");
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError("Refresh token has expired");
    }

    // Preferred, not fixed: resolveActiveBusiness falls back to the user's first remaining
    // membership if `existing.activeBusinessId` is no longer valid (e.g. membership revoked).
    const active = await this.resolveActiveBusiness(existing.userId, existing.activeBusinessId);
    const user = await this.usersRepository.findById(existing.userId, active.businessId);
    if (!user || !user.isActive) throw new UnauthorizedError("Account is not active");

    const newRawToken = generateOpaqueToken();
    await this.authRepository.revokeRefreshToken(existing.id, sha256(newRawToken));
    await this.authRepository.createRefreshToken({
      userId: user.id,
      // Carried forward unchanged from the token being rotated — refresh never switches business
      // on its own (only switchBusiness() does), even if resolveActiveBusiness had to fall back.
      activeBusinessId: existing.activeBusinessId,
      tokenHash: sha256(newRawToken),
      family: existing.family,
      deviceInfo: context.userAgent ?? existing.deviceInfo,
      ipAddress: context.ipAddress ?? existing.ipAddress,
      expiresAt: this.tokenService.getRefreshTokenExpiry(),
    });

    const { token: accessToken, expiresAt } = this.tokenService.signAccessToken({
      sub: user.id,
      roleId: active.roleId,
      roleName: active.roleName,
      businessId: active.businessId,
    });

    return {
      accessToken,
      accessTokenExpiresAt: expiresAt.toISOString(),
      refreshToken: newRawToken,
      activeBusinessId: active.businessId,
      availableBusinesses: active.availableBusinesses,
    };
  }

  async switchBusiness(
    userId: string,
    targetBusinessId: string,
    context: RequestContext = {},
  ): Promise<RefreshResult> {
    const membership = await this.businessesRepository.findMembership(userId, targetBusinessId);
    if (!membership) {
      throw new ForbiddenError("You do not have access to this business");
    }
    const active = await this.resolveActiveBusiness(userId, targetBusinessId);
    const user = await this.usersRepository.findById(userId, active.businessId);
    if (!user || !user.isActive) throw new UnauthorizedError("Account is not active");

    const family = generateTokenFamily();
    const refreshToken = await this.issueRefreshToken(userId, active.businessId, family, context);
    const { token: accessToken, expiresAt } = this.tokenService.signAccessToken({
      sub: userId,
      roleId: active.roleId,
      roleName: active.roleName,
      businessId: active.businessId,
    });

    await this.auditService.log({
      actorId: userId,
      action: "AUTH_BUSINESS_SWITCHED",
      entityType: "User",
      entityId: userId,
      metadata: { businessId: active.businessId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return {
      accessToken,
      accessTokenExpiresAt: expiresAt.toISOString(),
      refreshToken,
      activeBusinessId: active.businessId,
      availableBusinesses: active.availableBusinesses,
    };
  }

  async logout(rawToken: string): Promise<void> {
    const existing = await this.authRepository.findRefreshTokenByHash(sha256(rawToken));
    if (existing && !existing.isRevoked) {
      await this.authRepository.revokeRefreshToken(existing.id);
      await this.auditService.log({
        actorId: existing.userId,
        action: "AUTH_LOGOUT",
        entityType: "User",
        entityId: existing.userId,
      });
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.authRepository.revokeAllForUser(userId);
    await this.auditService.log({ actorId: userId, action: "AUTH_LOGOUT_ALL", entityType: "User", entityId: userId });
  }

  async listSessions(userId: string, currentRawToken?: string): Promise<SessionDto[]> {
    const currentHash = currentRawToken ? sha256(currentRawToken) : null;
    const sessions = await this.authRepository.findActiveSessionsForUser(userId);
    return sessions.map((session) => ({
      id: session.id,
      deviceInfo: session.deviceInfo,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt.toISOString(),
      isCurrent: currentHash !== null && session.tokenHash === currentHash,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const count = await this.authRepository.revokeById(sessionId, userId);
    if (count === 0) throw new NotFoundError("Session not found");
    await this.auditService.log({
      actorId: userId,
      action: "AUTH_SESSION_REVOKED",
      entityType: "RefreshToken",
      entityId: sessionId,
    });
  }

  async forgotPassword(email: string, context: RequestContext): Promise<void> {
    const user = await this.usersRepository.findByEmail(email, NO_BUSINESS_CONTEXT);
    if (!user) return;

    const rawToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000);
    await this.authRepository.createPasswordResetToken(user.id, sha256(rawToken), expiresAt);
    await this.emailService.queuePasswordResetEmail({
      to: user.email,
      firstName: user.firstName,
      resetToken: rawToken,
    });

    await this.auditService.log({
      actorId: user.id,
      action: "AUTH_PASSWORD_RESET_REQUESTED",
      entityType: "User",
      entityId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  async resetPassword(token: string, newPassword: string, context: RequestContext): Promise<void> {
    const record = await this.authRepository.findPasswordResetTokenByHash(sha256(token));
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError("Invalid or expired reset token");
    }

    const passwordHash = await hashPassword(newPassword);
    await this.usersRepository.updatePasswordHash(record.userId, passwordHash);
    await this.usersRepository.markEmailVerified(record.userId);
    await this.authRepository.markPasswordResetTokenUsed(record.id);
    await this.authRepository.revokeAllForUser(record.userId);

    await this.auditService.log({
      actorId: record.userId,
      action: "AUTH_PASSWORD_RESET_COMPLETED",
      entityType: "User",
      entityId: record.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.authRepository.findEmailVerificationTokenByHash(sha256(token));
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedError("Invalid or expired verification token");
    }

    await this.usersRepository.markEmailVerified(record.userId);
    await this.authRepository.markEmailVerificationTokenUsed(record.id);
    await this.auditService.log({
      actorId: record.userId,
      action: "AUTH_EMAIL_VERIFIED",
      entityType: "User",
      entityId: record.userId,
    });
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.usersRepository.findByEmail(email, NO_BUSINESS_CONTEXT);
    if (!user || user.isEmailVerified) return;

    const rawToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);
    await this.authRepository.createEmailVerificationToken(user.id, sha256(rawToken), expiresAt);
    await this.emailService.queueVerificationEmail({
      to: user.email,
      firstName: user.firstName,
      verificationToken: rawToken,
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.usersRepository.findById(userId, NO_BUSINESS_CONTEXT);
    if (!user) throw new NotFoundError("User not found");

    if (!(await comparePassword(currentPassword, user.passwordHash))) {
      throw new UnauthorizedError("Current password is incorrect");
    }
    if (await comparePassword(newPassword, user.passwordHash)) {
      throw new ConflictError("New password must be different from the current password");
    }

    const passwordHash = await hashPassword(newPassword);
    await this.usersRepository.updatePasswordHash(userId, passwordHash);
    await this.authRepository.revokeAllForUser(userId);

    await this.auditService.log({
      actorId: userId,
      action: "AUTH_PASSWORD_CHANGED",
      entityType: "User",
      entityId: userId,
    });
  }
}
