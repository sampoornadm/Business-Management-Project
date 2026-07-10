import type { EmailVerificationToken, PasswordResetToken, PrismaClient, RefreshToken } from "@bmp/database";

export interface CreateRefreshTokenData {
  userId: string;
  activeBusinessId: string;
  tokenHash: string;
  family: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  expiresAt: Date;
}

export interface IAuthRepository {
  createRefreshToken(data: CreateRefreshTokenData): Promise<RefreshToken>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null>;
  revokeRefreshToken(id: string, replacedByTokenHash?: string): Promise<void>;
  revokeFamily(userId: string, family: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
  revokeById(id: string, userId: string): Promise<number>;
  findActiveSessionsForUser(userId: string): Promise<RefreshToken[]>;

  createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<PasswordResetToken>;
  findPasswordResetTokenByHash(tokenHash: string): Promise<PasswordResetToken | null>;
  markPasswordResetTokenUsed(id: string): Promise<void>;

  createEmailVerificationToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<EmailVerificationToken>;
  findEmailVerificationTokenByHash(tokenHash: string): Promise<EmailVerificationToken | null>;
  markEmailVerificationTokenUsed(id: string): Promise<void>;
}

export class AuthRepository implements IAuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  createRefreshToken(data: CreateRefreshTokenData): Promise<RefreshToken> {
    return this.prisma.refreshToken.create({ data });
  }

  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async revokeRefreshToken(id: string, replacedByTokenHash?: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id },
      data: { isRevoked: true, replacedByTokenHash },
    });
  }

  async revokeFamily(userId: string, family: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, family, isRevoked: false },
      data: { isRevoked: true },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });
  }

  async revokeById(id: string, userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { id, userId, isRevoked: false },
      data: { isRevoked: true },
    });
    return result.count;
  }

  findActiveSessionsForUser(userId: string): Promise<RefreshToken[]> {
    return this.prisma.refreshToken.findMany({
      where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
  }

  createPasswordResetToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<PasswordResetToken> {
    return this.prisma.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
  }

  findPasswordResetTokenByHash(tokenHash: string): Promise<PasswordResetToken | null> {
    return this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  }

  async markPasswordResetTokenUsed(id: string): Promise<void> {
    await this.prisma.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } });
  }

  createEmailVerificationToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<EmailVerificationToken> {
    return this.prisma.emailVerificationToken.create({ data: { userId, tokenHash, expiresAt } });
  }

  findEmailVerificationTokenByHash(tokenHash: string): Promise<EmailVerificationToken | null> {
    return this.prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
  }

  async markEmailVerificationTokenUsed(id: string): Promise<void> {
    await this.prisma.emailVerificationToken.update({ where: { id }, data: { usedAt: new Date() } });
  }
}
