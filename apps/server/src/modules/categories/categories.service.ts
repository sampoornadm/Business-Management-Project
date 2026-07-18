import type { CategoryLeafDto, CategoryNodeDto } from "@bmp/types";

import { ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";

import { buildCategoryTree, buildPathMap, flattenLeaves } from "./categories.mapper.js";
import type { ICategoriesRepository } from "./categories.repository.js";

export class CategoriesService {
  constructor(private readonly categoriesRepository: ICategoriesRepository) {}

  async getTree(): Promise<CategoryNodeDto[]> {
    return buildCategoryTree(await this.categoriesRepository.findAll());
  }

  async getLeaves(): Promise<CategoryLeafDto[]> {
    return flattenLeaves(await this.categoriesRepository.findAll());
  }

  /** id -> full path ("Electrical > Cable"), for labelling an item's resolved category. */
  async getPathMap(): Promise<Map<string, string>> {
    return buildPathMap(await this.categoriesRepository.findAll());
  }

  async create(input: { parentId?: string | null; name: string; sortOrder?: number }): Promise<CategoryNodeDto[]> {
    const parentId = input.parentId ?? null;
    if (parentId && !(await this.categoriesRepository.findById(parentId))) {
      throw new NotFoundError("Parent category not found");
    }
    if (await this.categoriesRepository.findByParentAndName(parentId, input.name)) {
      throw new ConflictError("A category with this name already exists here");
    }
    await this.categoriesRepository.create({ parentId, name: input.name, sortOrder: input.sortOrder ?? 0 });
    return this.getTree();
  }

  async update(id: string, input: { name?: string; sortOrder?: number }): Promise<CategoryNodeDto[]> {
    const existing = await this.categoriesRepository.findById(id);
    if (!existing) throw new NotFoundError("Category not found");
    if (input.name && input.name !== existing.name) {
      const clash = await this.categoriesRepository.findByParentAndName(existing.parentId, input.name);
      if (clash && clash.id !== id) throw new ConflictError("A category with this name already exists here");
    }
    await this.categoriesRepository.update(id, input);
    return this.getTree();
  }

  async delete(id: string): Promise<CategoryNodeDto[]> {
    if (!(await this.categoriesRepository.findById(id))) throw new NotFoundError("Category not found");
    await this.categoriesRepository.delete(id);
    return this.getTree();
  }
}
