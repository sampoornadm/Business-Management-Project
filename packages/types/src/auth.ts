import type { UserDto } from "./user.js";

export interface LoginInput {
  email: string;
  password: string;
}

export interface AvailableBusiness {
  businessId: string;
  businessName: string;
  businessCode: string;
}

export interface LoginResponseDto {
  accessToken: string;
  accessTokenExpiresAt: string;
  user: UserDto;
  activeBusinessId: string;
  availableBusinesses: AvailableBusiness[];
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

export interface VerifyEmailInput {
  token: string;
}

export interface ResendVerificationInput {
  email: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface SessionDto {
  id: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  createdAt: string;
  isCurrent: boolean;
}
