import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { Router, type Request, type Response } from "express";

import { env } from "../config/env.js";
import { prisma } from "../infra/prisma/client.js";
import { emailQueue } from "../infra/queue/queues.js";
import { redis } from "../infra/redis/client.js";
import { s3Client } from "../infra/storage/s3.client.js";

export const healthRouter = Router();

async function checkPostgres(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  }
}

async function checkS3(): Promise<boolean> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    return true;
  } catch {
    return false;
  }
}

async function checkQueue(): Promise<boolean> {
  try {
    await emailQueue.waitUntilReady();
    return true;
  } catch {
    return false;
  }
}

/** Liveness: the process is up and can serve requests, no downstream dependency checks. */
healthRouter.get("/live", (_req, res) => {
  res.status(200).json({ success: true, message: "Liveness check", data: { alive: true } });
});

/** Readiness: every downstream dependency the app needs to actually function is reachable. */
async function readinessHandler(_req: Request, res: Response): Promise<void> {
  const [postgres, redis_, s3, queue] = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkS3(),
    checkQueue(),
  ]);
  const checks = { postgres, redis: redis_, s3, queue };
  const healthy = Object.values(checks).every(Boolean);
  res.status(healthy ? 200 : 503).json({ success: healthy, message: "Readiness check", data: checks });
}

healthRouter.get("/ready", readinessHandler);
// Backward-compatible alias: the existing frontend dashboard widget polls GET /health directly.
healthRouter.get("/", readinessHandler);
