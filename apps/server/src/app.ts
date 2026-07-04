import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import hpp from "hpp";
import swaggerUi from "swagger-ui-express";

import { RATE_LIMITS } from "./config/constants.js";
import { env, isProduction, isTest } from "./config/env.js";
import { openApiSpec } from "./docs/swagger.js";
import { metricsMiddleware, metricsRouter } from "./routes/metrics.js";
import { v1Router } from "./routes/v1.router.js";
import { httpLoggerMiddleware } from "./shared/logger/httpLogger.middleware.js";
import { errorHandlerMiddleware } from "./shared/middleware/errorHandler.middleware.js";
import { notFoundHandlerMiddleware } from "./shared/middleware/notFoundHandler.middleware.js";
import { createRateLimiter } from "./shared/middleware/rateLimiter.middleware.js";
import { requestIdMiddleware } from "./shared/middleware/requestId.middleware.js";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  const hstsOption = isProduction ? { maxAge: 15552000, includeSubDomains: true, preload: true } : false;
  const docsPath = `${env.API_BASE_PATH}/docs`;
  // Swagger UI is a real HTML page (inline bootstrap script + styles) served by this same app,
  // so it gets helmet's permissive CSP defaults; every other route is pure JSON and gets a
  // locked-down CSP since no HTML is ever rendered there.
  const docsHelmet = helmet({ hsts: hstsOption });
  const apiHelmet = helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"] } }, hsts: hstsOption });

  app.use(requestIdMiddleware);
  app.use(httpLoggerMiddleware);
  app.use(metricsMiddleware);
  app.use((req, res, next) => (req.path.startsWith(docsPath) ? docsHelmet(req, res, next) : apiHelmet(req, res, next)));
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(hpp());

  app.get("/metrics", metricsRouter);

  if (!isTest) {
    app.use(env.API_BASE_PATH, createRateLimiter("general", RATE_LIMITS.GENERAL.windowMs, RATE_LIMITS.GENERAL.max));
  }

  app.use(`${env.API_BASE_PATH}/docs`, swaggerUi.serve, swaggerUi.setup(openApiSpec));
  app.get(`${env.API_BASE_PATH}/docs.json`, (_req, res) => res.json(openApiSpec));

  app.use(env.API_BASE_PATH, v1Router);

  app.use(notFoundHandlerMiddleware);
  app.use(errorHandlerMiddleware);

  return app;
}
