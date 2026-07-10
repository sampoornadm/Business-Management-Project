import { randomBytes } from "node:crypto";

import type { Prisma } from "@bmp/database";
import type { PaginatedResult, UserDto } from "@bmp/types";

import { AVATAR_UPLOAD_LIMITS } from "../../config/constants.js";
import { env } from "../../config/env.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";
import type { EmailService } from "../../infra/mailer/email.service.js";
import { hashPassword, sha256 } from "../../shared/utils/hash.js";
import { generateOpaqueToken } from "../../shared/utils/tokens.js";
import type { AttachmentsService } from "../attachments/attachments.service.js";
import type { AuditService } from "../audit/audit.service.js";
import type { IAuthRepository } from "../auth/auth.repository.js";
import type { IRolesRepository } from "../roles/roles.repository.js";

import { toUserDto } from "./users.mapper.js";
import type { IUsersRepository, UserFilters, UpdateUserData, UserWithRole } from "./users.repository.js";

export interface CreateUserInput {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  roleId: string;
}

export interface UploadedAvatarFile {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}

export class UsersService {
  constructor(
    private readonly usersRepository: IUsersRepository,
    private readonly rolesRepository: IRolesRepository,
    private readonly authRepository: IAuthRepository,
    private readonly auditService: AuditService,
    private readonly attachmentsService: AttachmentsService,
    private readonly emailService: EmailService,
  ) {}

  private toDto(user: Parameters<typeof toUserDto>[0]): Promise<UserDto> {
    return toUserDto(user, this.attachmentsService);
  }

  /**
   * findById/findByEmail pre-filter the included `userBusinesses` relation to the queried
   * business, but Prisma's findUnique still returns the User row even when that filtered
   * relation comes back empty (e.g. an id that exists globally but has no membership in this
   * business) — treat that the same as "not found" rather than let toUserDto crash reading
   * `userBusinesses[0]!` off an empty array.
   */
  private assertMember(user: UserWithRole | null): UserWithRole {
    if (!user || user.userBusinesses.length === 0) throw new NotFoundError("User not found");
    return user;
  }

  async listUsers(
    pagination: PaginationParams,
    filters: UserFilters,
  ): Promise<PaginatedResult<UserDto>> {
    const { items, totalItems } = await this.usersRepository.findMany(pagination, filters);
    const dtos = await Promise.all(items.map((item) => this.toDto(item)));
    return buildPaginatedResult(dtos, totalItems, pagination);
  }

  async getById(id: string, businessId: string): Promise<UserDto> {
    const user = this.assertMember(await this.usersRepository.findById(id, businessId));
    return this.toDto(user);
  }

  async createUser(
    input: CreateUserInput,
    actorId: string,
    businessId: string,
    context: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<UserDto> {
    const existing = await this.usersRepository.findByEmail(input.email, businessId);
    if (existing) throw new ConflictError("A user with this email already exists");

    const role = await this.rolesRepository.findById(input.roleId);
    if (!role) throw new BadRequestError("Invalid role");

    const unusablePasswordHash = await hashPassword(randomBytes(32).toString("hex"));
    const user = await this.usersRepository.create({
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      businessId,
      roleId: input.roleId,
      passwordHash: unusablePasswordHash,
      createdById: actorId,
      isEmailVerified: false,
    });

    const setPasswordToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);
    await this.authRepository.createPasswordResetToken(user.id, sha256(setPasswordToken), expiresAt);
    await this.emailService.queueInviteEmail({
      to: user.email,
      firstName: user.firstName,
      setPasswordToken,
    });

    await this.auditService.log({
      actorId,
      action: "USER_CREATED",
      entityType: "User",
      entityId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.toDto(user);
  }

  async updateUser(
    id: string,
    data: UpdateUserData,
    actorId: string,
    businessId: string,
    context: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<UserDto> {
    this.assertMember(await this.usersRepository.findById(id, businessId));

    const user = await this.usersRepository.update(id, data, businessId);

    if (data.isActive === false) {
      await this.authRepository.revokeAllForUser(id);
    }

    await this.auditService.log({
      actorId,
      action: "USER_UPDATED",
      entityType: "User",
      entityId: id,
      metadata: data as unknown as Prisma.InputJsonValue,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.toDto(user);
  }

  async updateOwnProfile(
    userId: string,
    data: { firstName?: string; lastName?: string; phone?: string | null },
    businessId: string,
  ): Promise<UserDto> {
    const user = await this.usersRepository.update(userId, data, businessId);
    await this.auditService.log({
      actorId: userId,
      action: "USER_PROFILE_UPDATED",
      entityType: "User",
      entityId: userId,
    });
    return this.toDto(user);
  }

  async assignRole(
    id: string,
    roleId: string,
    actorId: string,
    businessId: string,
    context: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<UserDto> {
    this.assertMember(await this.usersRepository.findById(id, businessId));

    const role = await this.rolesRepository.findById(roleId);
    if (!role) throw new BadRequestError("Invalid role");

    const user = await this.usersRepository.assignRole(id, businessId, roleId);

    await this.auditService.log({
      actorId,
      action: "USER_ROLE_ASSIGNED",
      entityType: "User",
      entityId: id,
      metadata: { roleId },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.toDto(user);
  }

  async deactivateUser(
    id: string,
    actorId: string,
    businessId: string,
    context: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<UserDto> {
    return this.updateUser(id, { isActive: false }, actorId, businessId, context);
  }

  async uploadAvatar(userId: string, file: UploadedAvatarFile, businessId: string): Promise<UserDto> {
    const existing = this.assertMember(await this.usersRepository.findById(userId, businessId));

    const previousAvatarId = existing.avatarAttachmentId;

    const { original } = await this.attachmentsService.upload({
      fileBuffer: file.buffer,
      originalName: file.originalName,
      declaredMimeType: file.mimeType,
      entityType: "User",
      entityId: userId,
      uploadedById: userId,
      allowedMimeTypes: AVATAR_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
      maxSizeBytes: AVATAR_UPLOAD_LIMITS.MAX_SIZE_BYTES,
      generateImageVariants: true,
      imageMaxDimension: AVATAR_UPLOAD_LIMITS.ORIGINAL_MAX_DIMENSION,
      thumbnailDimension: AVATAR_UPLOAD_LIMITS.THUMBNAIL_DIMENSION,
    });

    await this.usersRepository.updateAvatarAttachmentId(userId, original.id);

    if (previousAvatarId) {
      await this.attachmentsService.deleteById(previousAvatarId);
    }

    await this.auditService.log({
      actorId: userId,
      action: "USER_AVATAR_UPDATED",
      entityType: "User",
      entityId: userId,
    });

    const updated = await this.usersRepository.findById(userId, businessId);
    return this.toDto(updated!);
  }
}
