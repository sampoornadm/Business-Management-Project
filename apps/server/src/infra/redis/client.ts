import Redis from "ioredis";

import { env } from "../../config/env.js";
import { logger } from "../../shared/logger/logger.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

redis.on("error", (err) => {
  logger.error({ err }, "Redis connection error");
});
