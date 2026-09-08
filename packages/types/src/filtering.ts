export type FilterColumnType = "text" | "number" | "date" | "enum" | "boolean";

export const FILTER_OPERATORS = [
  "is",
  "is_not",
  "contains",
  "has_any_value",
  "gt",
  "lt",
  "between",
  "before",
  "after",
  "any_of",
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface FilterCondition {
  columnKey: string;
  operator: FilterOperator;
  value?: string | number | (string | number)[];
}
