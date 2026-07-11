import type { PrismaClient } from "@bmp/database";

/**
 * `Business` is deliberately excluded from `SCOPED_MODELS` (see scoped-client.ts) — it's the
 * tenant list itself, not a business-scoped resource. This is the one place an unscoped Business
 * query is correct: fetching every business id so a caller can loop scoped, per-business queries
 * across all tenants. Used by cross-business background jobs (e.g. the tender reminder worker)
 * and by cross-business aggregates over globally-shared entities (e.g. Organization's tender
 * count, which must sum a scoped model's count across every business).
 */
export async function listAllBusinessIds(prisma: PrismaClient): Promise<string[]> {
  const businesses = await prisma.business.findMany({ select: { id: true } });
  return businesses.map((business) => business.id);
}
