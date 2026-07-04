import { PAGINATION_DEFAULTS } from "../../config/constants.js";
import type { PaginationParams } from "../../core/interfaces/pagination.js";

export function resolvePagination(query: { page?: number; pageSize?: number }): PaginationParams {
  const page = query.page && query.page > 0 ? Math.floor(query.page) : PAGINATION_DEFAULTS.PAGE;
  const pageSize =
    query.pageSize && query.pageSize > 0
      ? Math.min(Math.floor(query.pageSize), PAGINATION_DEFAULTS.MAX_PAGE_SIZE)
      : PAGINATION_DEFAULTS.PAGE_SIZE;
  return { page, pageSize };
}

export function toSkipTake(params: PaginationParams): { skip: number; take: number } {
  return { skip: (params.page - 1) * params.pageSize, take: params.pageSize };
}
