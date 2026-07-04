import { Prisma } from "@bmp/database";
import type { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";

import { AppError } from "../../core/errors/AppError.js";
import { BadRequestError, ConflictError, NotFoundError, UnprocessableEntityError } from "../../core/errors/HttpErrors.js";
import { logger } from "../logger/logger.js";

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new UnprocessableEntityError(
      "Validation failed",
      err.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
    );
  }

  if (err instanceof MulterError) {
    return new BadRequestError(`Upload error: ${err.message}`);
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(", ") : "field";
      return new ConflictError(`A record with this ${target} already exists`);
    }
    if (err.code === "P2025") {
      return new NotFoundError("Record not found");
    }
  }

  return new AppError({
    statusCode: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred",
    isOperational: false,
  });
}

 
export function errorHandlerMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appError = toAppError(err);
  const originalError = err instanceof Error ? err : new Error(String(err));

  const logPayload = {
    requestId: req.id,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    statusCode: appError.statusCode,
  };

  if (!appError.isOperational || appError.statusCode >= 500) {
    logger.error({ ...logPayload, err: originalError }, "Unhandled error");
  } else {
    logger.warn(logPayload, appError.message);
  }

  res.status(appError.statusCode).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details,
      requestId: req.id,
    },
  });
}
