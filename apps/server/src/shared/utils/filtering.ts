import type { FilterCondition, FilterColumnType, FilterOperator } from "@bmp/types";

export interface FilterableColumnDescriptor {
  type: FilterColumnType;
  prismaPath: string[];
  nullable?: boolean;
}

// Mirrors packages/ui/src/lib/filterable-column.ts's OPERATORS_BY_TYPE. Server-owned rather than
// imported — apps/server cannot depend on packages/ui, and packages/ui is deliberately
// dependency-free of @bmp/types (see that file's own comment). A client that sends an
// operator/type pair outside this table can only reach here via a hand-crafted request or a
// stale saved view; such clauses are dropped rather than reaching Prisma, matching the existing
// behavior for an unknown columnKey below (silently excluded from the where clause, not a 400).
const OPERATORS_BY_TYPE: Record<FilterColumnType, FilterOperator[]> = {
  text: ["is", "is_not", "contains", "has_any_value"],
  number: ["is", "gt", "lt", "between", "has_any_value"],
  date: ["is", "before", "after", "between", "has_any_value"],
  enum: ["is", "is_not", "any_of", "has_any_value"],
  boolean: ["is"],
};

function isEmptyValue(value: FilterCondition["value"]): boolean {
  return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function coerceScalar(type: FilterColumnType, value: string | number): string | number | Date {
  if (type === "date") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date;
  }
  if (type === "number") {
    const num = Number(value);
    return Number.isNaN(num) ? value : num;
  }
  return value;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function buildPredicate(
  type: FilterColumnType,
  operator: FilterOperator,
  value: FilterCondition["value"],
): Record<string, unknown> | null {
  if (!OPERATORS_BY_TYPE[type].includes(operator)) return null;
  if (operator !== "has_any_value" && isEmptyValue(value)) return null;

  switch (operator) {
    case "is": {
      if (type === "date") {
        const coerced = coerceScalar(type, value as string | number);
        if (!(coerced instanceof Date)) return null;
        const start = startOfUtcDay(coerced);
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        return { gte: start, lt: end };
      }
      return { equals: coerceScalar(type, value as string | number) };
    }
    case "is_not":
      return { not: coerceScalar(type, value as string | number) };
    case "contains":
      return { contains: value as string, mode: "insensitive" };
    case "has_any_value":
      return { not: null };
    case "gt":
      return { gt: coerceScalar(type, value as string | number) };
    case "lt":
      return { lt: coerceScalar(type, value as string | number) };
    case "before":
      return { lt: coerceScalar(type, value as string | number) };
    case "after":
      return { gt: coerceScalar(type, value as string | number) };
    case "between": {
      if (!Array.isArray(value) || value.length !== 2) return null;
      const [min, max] = value as [string | number, string | number];
      return { gte: coerceScalar(type, min), lte: coerceScalar(type, max) };
    }
    case "any_of":
      return Array.isArray(value) ? { in: value } : null;
    default: {
      const exhaustive: never = operator;
      throw new Error(`Unsupported filter operator: ${String(exhaustive)}`);
    }
  }
}

function nestPath(path: string[], predicate: Record<string, unknown>): Record<string, unknown> {
  return path.reduceRight<Record<string, unknown>>((acc, key) => ({ [key]: acc }), predicate);
}

export function buildPrismaFilterWhere(
  filters: FilterCondition[],
  descriptors: Record<string, FilterableColumnDescriptor>,
): Record<string, unknown> {
  const clauses = filters
    .map((filter) => {
      const descriptor = descriptors[filter.columnKey];
      if (!descriptor) return null;
      const predicate = buildPredicate(descriptor.type, filter.operator, filter.value);
      if (!predicate) return null;
      return nestPath(descriptor.prismaPath, predicate);
    })
    .filter((clause): clause is Record<string, unknown> => clause !== null);

  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0]!;
  return { AND: clauses };
}
