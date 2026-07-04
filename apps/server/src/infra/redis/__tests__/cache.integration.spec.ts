import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getCachedJson, setCachedJson } from "../cache.js";
import { redis } from "../client.js";

/** Requires a real Redis reachable via .env.test (`docker compose up`). */
describe("getCachedJson / setCachedJson (integration)", () => {
  const keys: string[] = [];

  afterAll(async () => {
    if (keys.length > 0) await redis.del(...keys);
  });

  it("returns null for a key that was never set", async () => {
    const key = `test:cache:${randomUUID()}`;
    keys.push(key);
    expect(await getCachedJson(key)).toBeNull();
  });

  it("round-trips an arbitrary JSON value", async () => {
    const key = `test:cache:${randomUUID()}`;
    keys.push(key);
    const value = { totalTenders: 4, winRate: 75, byStatus: [{ status: "WON", count: 3 }] };

    await setCachedJson(key, value, 60);
    const hit = await getCachedJson<typeof value>(key);

    expect(hit).toEqual(value);
  });

  it("expires the key after the given TTL", async () => {
    const key = `test:cache:${randomUUID()}`;
    keys.push(key);

    await setCachedJson(key, { foo: "bar" }, 1);
    const ttl = await redis.ttl(key);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1);
  });
});
