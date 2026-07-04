import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

declare module "express-serve-static-core" {
  interface Request {
    id: string;
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers["x-request-id"];
  req.id = typeof inbound === "string" && inbound.length > 0 ? inbound : randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}
