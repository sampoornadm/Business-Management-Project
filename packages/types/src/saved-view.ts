import type { FilterCondition } from "./filtering.js";

export interface SavedViewDto {
  id: string;
  pageKey: string;
  name: string;
  filters: FilterCondition[];
  visibleColumns: string[];
  columnOrder: string[];
  sortBy: string | null;
  sortDir: "asc" | "desc" | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedViewInput {
  pageKey: string;
  name: string;
  filters: FilterCondition[];
  visibleColumns: string[];
  columnOrder: string[];
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export type UpdateSavedViewInput = Partial<Omit<CreateSavedViewInput, "pageKey">>;
