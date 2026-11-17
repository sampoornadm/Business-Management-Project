import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";

import { TooManyRequestsError } from "../../core/errors/HttpErrors.js";
import { redis } from "../../infra/redis/client.js";

export function createRateLimiter(name: string, windowMs: number, max: number): RequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // The integration suite logs in far more than 10 times from one address; limiting there
    // only makes unrelated tests fail with 429s that look like real bugs.
    skip: () => process.env.NODE_ENV === "test",
    store: new RedisStore({
      prefix: `ratelimit:${name}:`,
      sendCommand: (...args: string[]) =>
        redis.call(args[0]!, ...args.slice(1)) as Promise<never>,
    }),
    handler: (_req, _res, next) => {
      next(new TooManyRequestsError("Too many requests, please try again later"));
    },
  });
}
