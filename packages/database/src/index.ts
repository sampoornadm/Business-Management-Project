import { PrismaClient } from "../generated/client/index.js";

export * from "../generated/client/index.js";

declare global {
   
  var __bmpPrismaClient: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Reuse a single client across hot-reloads in dev to avoid exhausting the
// Postgres connection pool; each Node process still gets exactly one client.
export const prisma: PrismaClient = globalThis.__bmpPrismaClient ?? createPrismaClient();

if (process.env.NODE_ENV === "development") {
  globalThis.__bmpPrismaClient = prisma;
}
