// Editable classification taxonomy. Two tiers today (trade -> subcategory); the shape is
// recursive so a third tier needs no type change. Items reference a leaf node.
export interface CategoryNodeDto {
  id: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  children: CategoryNodeDto[];
}

// A flattened leaf, with its full path ("Electrical > Cable") — what the AI classifier and
// the item pickers choose from.
export interface CategoryLeafDto {
  id: string;
  name: string;
  path: string;
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
