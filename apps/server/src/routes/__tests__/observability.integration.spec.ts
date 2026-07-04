import { prisma } from "@bmp/database";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";

/** Requires a real Postgres + Redis + MinIO reachable via .env.test (`docker compose up`). */
describe("Health & metrics (integration)", () => {
  const app = createApp();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("GET /health/live reports the process is alive with no dependency checks", async () => {
    const response = await request(app).get("/api/v1/health/live");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ alive: true });
  });

  it("GET /health/ready reports every downstream dependency as healthy", async () => {
    const response = await request(app).get("/api/v1/health/ready");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ postgres: true, redis: true, s3: true, queue: true });
  });

  it("GET /health aliases /health/ready", async () => {
    const response = await request(app).get("/api/v1/health");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ postgres: true, redis: true, s3: true, queue: true });
  });

  it("GET /metrics returns Prometheus text exposition format", async () => {
    const response = await request(app).get("/metrics");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("http_request_duration_seconds");
  });
});
