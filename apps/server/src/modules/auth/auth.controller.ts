import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../core/errors/HttpErrors.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { AuthService } from "./auth.service.js";
import type {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginBody,
  ResendVerificationBody,
  ResetPasswordBody,
  VerifyEmailBody,
} from "./auth.validation.js";
import { clearRefreshTokenCookie, setRefreshTokenCookie } from "./cookies.js";

export class AuthController {
  constructor(private readonly authService: AuthService) {}

  login = asyncHandler(async (req, res) => {
    const body = req.body as LoginBody;
    const context = { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
    const { refreshToken, ...result } = await this.authService.login(body.email, body.password, context);
    setRefreshTokenCookie(res, refreshToken);
    sendSuccess(res, result, "Login successful");
  });

  refresh = asyncHandler(async (req, res) => {
    const rawToken = req.cookies?.[env.REFRESH_TOKEN_COOKIE_NAME];
    if (!rawToken) throw new UnauthorizedError("Missing refresh token");

    const context = { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
    const result = await this.authService.refresh(rawToken, context);
    setRefreshTokenCookie(res, result.refreshToken);
    sendSuccess(res, {
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
    }, "Token refreshed");
  });

  logout = asyncHandler(async (req, res) => {
    const rawToken = req.cookies?.[env.REFRESH_TOKEN_COOKIE_NAME];
    if (rawToken) await this.authService.logout(rawToken);
    clearRefreshTokenCookie(res);
    sendSuccess(res, null, "Logged out");
  });

  logoutAll = asyncHandler(async (req, res) => {
    await this.authService.logoutAll(req.user!.id);
    clearRefreshTokenCookie(res);
    sendSuccess(res, null, "Logged out from all devices");
  });

  listSessions = asyncHandler(async (req, res) => {
    const rawToken = req.cookies?.[env.REFRESH_TOKEN_COOKIE_NAME];
    const sessions = await this.authService.listSessions(req.user!.id, rawToken);
    sendSuccess(res, sessions, "Sessions retrieved");
  });

  revokeSession = asyncHandler(async (req, res) => {
    await this.authService.revokeSession(req.user!.id, req.params.id!);
    sendSuccess(res, null, "Session revoked");
  });

  forgotPassword = asyncHandler(async (req, res) => {
    const body = req.body as ForgotPasswordBody;
    await this.authService.forgotPassword(body.email, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, null, "If that email exists, a reset link has been sent");
  });

  resetPassword = asyncHandler(async (req, res) => {
    const body = req.body as ResetPasswordBody;
    await this.authService.resetPassword(body.token, body.newPassword, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, null, "Password has been reset");
  });

  verifyEmail = asyncHandler(async (req, res) => {
    const body = req.body as VerifyEmailBody;
    await this.authService.verifyEmail(body.token);
    sendSuccess(res, null, "Email verified");
  });

  resendVerification = asyncHandler(async (req, res) => {
    const body = req.body as ResendVerificationBody;
    await this.authService.resendVerification(body.email);
    sendSuccess(res, null, "If that email exists, a verification link has been sent");
  });

  changePassword = asyncHandler(async (req, res) => {
    const body = req.body as ChangePasswordBody;
    await this.authService.changePassword(req.user!.id, body.currentPassword, body.newPassword);
    sendSuccess(res, null, "Password changed");
  });
}
