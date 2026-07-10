import type { Prisma, PrismaClient } from "@bmp/database";

export const SCOPED_MODELS = new Set([
  "Tender",
  "Project",
  "Boq",
  "Rfq",
  "PurchaseOrder",
  "GoodsReceipt",
  "BankAccount",
  "Invoice",
  "Expense",
  "Payment",
  "HistoricalRate",
]);

const READ_ACTIONS = new Set(["findFirst", "findFirstOrThrow", "findMany", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy", "updateMany", "deleteMany"]);

function whereContainsBusinessId(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  const clause = where as Record<string, unknown>;
  if ("businessId" in clause) return true;
  for (const key of ["AND", "OR"] as const) {
    const nested = clause[key];
    if (Array.isArray(nested) && nested.some((entry) => whereContainsBusinessId(entry))) return true;
  }
  return false;
}

export function assertBusinessScoped(model: string, where: unknown): void {
  if (!SCOPED_MODELS.has(model)) return;
  if (!whereContainsBusinessId(where)) {
    throw new Error(
      `Refusing to run a ${model} query with no businessId in its where clause — every read/update/delete against a business-scoped model must filter by businessId.`,
    );
  }
}

export function withBusinessScopeGuard(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (model && READ_ACTIONS.has(operation)) {
            assertBusinessScoped(model, (args as { where?: unknown }).where);
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}
