import { Router } from "express";

import { RATE_LIMITS } from "../../config/constants.js";
import { authenticateMiddleware } from "../../shared/middleware/authenticate.middleware.js";
import { createRateLimiter } from "../../shared/middleware/rateLimiter.middleware.js";
import { validate } from "../../shared/middleware/validate.middleware.js";

import type { AuthController } from "./auth.controller.js";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "./auth.validation.js";

export function createAuthRouter(controller: AuthController): Router {
  const router = Router();

  const loginLimiter = createRateLimiter("login", RATE_LIMITS.LOGIN.windowMs, RATE_LIMITS.LOGIN.max);
  const refreshLimiter = createRateLimiter(
    "refresh",
    RATE_LIMITS.REFRESH.windowMs,
    RATE_LIMITS.REFRESH.max,
  );
  const forgotPasswordLimiter = createRateLimiter(
    "forgot-password",
    RATE_LIMITS.FORGOT_PASSWORD.windowMs,
    RATE_LIMITS.FORGOT_PASSWORD.max,
  );

  /**
   * @openapi
   * /auth/login:
   *   post:
   *     tags: [Auth]
   *     summary: Log in with email and password
   *     responses:
   *       200: { description: Login successful }
   */
  router.post("/login", loginLimiter, validate(loginSchema), controller.login);

  /**
   * @openapi
   * /auth/refresh:
   *   post:
   *     tags: [Auth]
   *     summary: Rotate the refresh token cookie and issue a new access token
   *     responses:
   *       200: { description: Token refreshed }
   */
  router.post("/refresh", refreshLimiter, controller.refresh);

  /**
   * @openapi
   * /auth/logout:
   *   post:
   *     tags: [Auth]
   *     summary: Log out the current session
   *     responses:
   *       200: { description: Logged out }
   */
  router.post("/logout", controller.logout);

  /**
   * @openapi
   * /auth/logout-all:
   *   post:
   *     tags: [Auth]
   *     summary: Log out of all devices/sessions
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Logged out everywhere }
   */
  router.post("/logout-all", authenticateMiddleware, controller.logoutAll);

  /**
   * @openapi
   * /auth/sessions:
   *   get:
   *     tags: [Auth]
   *     summary: List active sessions/devices for the current user
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: List of sessions }
   */
  router.get("/sessions", authenticateMiddleware, controller.listSessions);

  /**
   * @openapi
   * /auth/sessions/{id}:
   *   delete:
   *     tags: [Auth]
   *     summary: Revoke one of the current user's own sessions
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Session revoked }
   */
  router.delete("/sessions/:id", authenticateMiddleware, controller.revokeSession);

  /**
   * @openapi
   * /auth/forgot-password:
   *   post:
   *     tags: [Auth]
   *     summary: Request a password reset email
   *     responses:
   *       200: { description: Reset email sent if the account exists }
   */
  router.post(
    "/forgot-password",
    forgotPasswordLimiter,
    validate(forgotPasswordSchema),
    controller.forgotPassword,
  );

  /**
   * @openapi
   * /auth/reset-password:
   *   post:
   *     tags: [Auth]
   *     summary: Reset a password using a reset token
   *     responses:
   *       200: { description: Password reset }
   */
  router.post("/reset-password", validate(resetPasswordSchema), controller.resetPassword);

  /**
   * @openapi
   * /auth/verify-email:
   *   post:
   *     tags: [Auth]
   *     summary: Verify an email address using a verification token
   *     responses:
   *       200: { description: Email verified }
   */
  router.post("/verify-email", validate(verifyEmailSchema), controller.verifyEmail);

  /**
   * @openapi
   * /auth/resend-verification:
   *   post:
   *     tags: [Auth]
   *     summary: Resend the email verification link
   *     responses:
   *       200: { description: Verification email sent if applicable }
   */
  router.post(
    "/resend-verification",
    validate(resendVerificationSchema),
    controller.resendVerification,
  );

  /**
   * @openapi
   * /auth/change-password:
   *   post:
   *     tags: [Auth]
   *     summary: Change the current user's password
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Password changed }
   */
  router.post(
    "/change-password",
    authenticateMiddleware,
    validate(changePasswordSchema),
    controller.changePassword,
  );

  return router;
}
