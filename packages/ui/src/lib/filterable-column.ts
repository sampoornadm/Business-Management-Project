// packages/ui stays domain-agnostic and free of a @bmp/types dependency (see CLAUDE.md's "no
// tender/user strings in packages/ui" rule). These mirror the same literal unions independently
// declared in @bmp/types' filtering.ts — structurally identical, so a caller passing a real
// FilterCondition from @bmp/types satisfies this file's types with no casting needed.
export type FilterColumnType = "text" | "number" | "date" | "enum" | "boolean";

export type FilterOperator =
  | "is"
  | "is_not"
  | "contains"
  | "has_any_value"
  | "gt"
  | "lt"
  | "between"
  | "before"
  | "after"
  | "any_of";

export interface FilterableColumnDef {
  key: string;
  label: string;
  type: FilterColumnType;
  nullable?: boolean;
  enumOptions?: { value: string; label: string }[];
}

export interface FilterCondition {
  columnKey: string;
  operator: FilterOperator;
  value?: string | number | (string | number)[];
}

const OPERATORS_BY_TYPE: Record<FilterColumnType, FilterOperator[]> = {
  text: ["is", "is_not", "contains", "has_any_value"],
  number: ["is", "gt", "lt", "between", "has_any_value"],
  date: ["is", "before", "after", "between", "has_any_value"],
  enum: ["is", "is_not", "any_of", "has_any_value"],
  boolean: ["is"],
};

export function operatorsForColumn(column: FilterableColumnDef): FilterOperator[] {
  const operators = OPERATORS_BY_TYPE[column.type];
  return column.nullable ? operators : operators.filter((op) => op !== "has_any_value");
}

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  has_any_value: "has any value",
  gt: "is greater than",
  lt: "is less than",
  between: "is between",
  before: "is before",
  after: "is after",
  any_of: "is any of",
};

export function operatorLabel(operator: FilterOperator): string {
  return OPERATOR_LABELS[operator];
}
