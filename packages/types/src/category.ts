// Classification taxonomy, derived from the CBIC tariff: chapters (2-digit) -> headings (4-digit).
// The shape is recursive so a third tier needs no type change. Items reference a leaf node.
export interface CategoryNodeDto {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  /** 2-digit chapter or 4-digit heading. Null only for pre-tariff legacy nodes. */
  code?: string | null;
  /** False for nodes that must not be offered as a choice (e.g. chapters never bought from). */
  active?: boolean;
  children: CategoryNodeDto[];
}

// A flattened leaf, with its full path ("Articles of iron or steel > Tube or pipe fittings") —
// what the classifier and the item pickers choose from. A leaf's `code` IS its HSN code.
export interface CategoryLeafDto {
  id: string;
  name: string;
  path: string;
  code: string | null;
}

export interface CreateCategoryInput {
  parentId?: string | null;
  name: string;
  sortOrder?: number;
}

export interface UpdateCategoryInput {
  name?: string;
  sortOrder?: number;
}
