import type { CategoryLeafDto, CategoryNodeDto } from "@bmp/types";

import type { CategoryRow } from "./categories.repository.js";

export function buildCategoryTree(rows: CategoryRow[]): CategoryNodeDto[] {
  const byId = new Map<string, CategoryNodeDto>();
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }

  const roots: CategoryNodeDto[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortRec = (nodes: CategoryNodeDto[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/** id -> full path, e.g. "Electrical > Cable". Every node, not just leaves. */
export function buildPathMap(rows: CategoryRow[]): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cache = new Map<string, string>();

  const pathOf = (id: string): string => {
    const cached = cache.get(id);
    if (cached) return cached;
    const row = byId.get(id);
    if (!row) return "";
    const path = row.parentId && byId.has(row.parentId) ? `${pathOf(row.parentId)} > ${row.name}` : row.name;
    cache.set(id, path);
    return path;
  };

  for (const row of rows) pathOf(row.id);
  return cache;
}

/**
 * Leaf nodes (no children) with their full path — what item pickers and the AI choose from.
 *
 * Inactive nodes are excluded: the tariff taxonomy contains entries nothing can legitimately be
 * classified as (chapter 77 is literally "Reserved for possible future use", and a business can
 * switch off chapters it never buys from). They stay in the tree for the admin UI, but they must
 * never be offered as a choice.
 */
export function flattenLeaves(rows: CategoryRow[]): CategoryLeafDto[] {
  const active = rows.filter((r) => r.active);
  const parentIds = new Set(active.map((r) => r.parentId).filter((id): id is string => Boolean(id)));
  const paths = buildPathMap(rows);
  return active
    .filter((r) => !parentIds.has(r.id))
    .map((r) => ({ id: r.id, name: r.name, path: paths.get(r.id) ?? r.name, code: r.code ?? null }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
