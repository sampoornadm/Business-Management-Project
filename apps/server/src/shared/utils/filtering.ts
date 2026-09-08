import type { FilterCondition, FilterColumnType, FilterOperator } from "@bmp/types";

export interface FilterableColumnDescriptor {
  type: FilterColumnType;
  prismaPath: string[];
  nullable?: boolean;
}

function buildPredicate(operator: FilterOperator, value: FilterCondition["value"]): Record<string, unknown> {
  switch (operator) {
    case "is":
      return { equals: value };
    case "is_not":
      return { not: value };
    case "contains":
      return { contains: value as string, mode: "insensitive" };
    case "has_any_value":
      return { not: null };
    case "gt":
      return { gt: value };
    case "lt":
      return { lt: value };
    case "before":
      return { lt: value };
    case "after":
      return { gt: value };
    case "between": {
      const [min, max] = value as [string | number, string | number];
      return { gte: min, lte: max };
    }
    case "any_of":
      return { in: value as (string | number)[] };
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
      const predicate = buildPredicate(filter.operator, filter.value);
      return nestPath(descriptor.prismaPath, predicate);
    })
    .filter((clause): clause is Record<string, unknown> => clause !== null);

  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0]!;
  return { AND: clauses };
}
