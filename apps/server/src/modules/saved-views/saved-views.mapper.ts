import type { SavedView } from "@bmp/database";
import type { FilterCondition, SavedViewDto } from "@bmp/types";

export function toSavedViewDto(entity: SavedView): SavedViewDto {
  return {
    id: entity.id,
    pageKey: entity.pageKey,
    name: entity.name,
    filters: entity.filters as unknown as FilterCondition[],
    visibleColumns: entity.visibleColumns as unknown as string[],
    columnOrder: entity.columnOrder as unknown as string[],
    sortBy: entity.sortBy,
    sortDir: entity.sortDir as "asc" | "desc" | null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
