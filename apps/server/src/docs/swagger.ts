import path from "node:path";
import { fileURLToPath } from "node:url";

import swaggerJsdoc from "swagger-jsdoc";

import { env } from "../config/env.js";

// Resolve to apps/server/src regardless of whether this file is executed
// from src (tsx, dev) or dist (compiled, prod) — both live one level under
// apps/server, and we always want to parse the original .ts JSDoc comments.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(currentDir, "../..");

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Business Management Platform API",
      version: "0.1.0",
      description: "Phase 1 (Foundation): authentication, RBAC, user management, and file uploads.",
    },
    servers: [{ url: `http://localhost:${env.SERVER_PORT}${env.API_BASE_PATH}` }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        ApiSuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string" },
            data: { type: "object" },
          },
        },
        ApiErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                requestId: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
  apis: [
    path.join(serverRoot, "src/modules/**/*.routes.ts"),
    path.join(serverRoot, "src/routes/**/*.ts"),
  ],
};

export const openApiSpec = swaggerJsdoc(options);
