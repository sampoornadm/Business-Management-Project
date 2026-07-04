import type { TagDto } from "@bmp/types";

import { ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";

import type { CreateTagData, ITagsRepository, UpdateTagData } from "./tags.repository.js";

function toDto(tag: { id: string; name: string; color: string | null; createdAt: Date }): TagDto {
  return { id: tag.id, name: tag.name, color: tag.color, createdAt: tag.createdAt.toISOString() };
}

export class TagsService {
  constructor(private readonly tagsRepository: ITagsRepository) {}

  async list(): Promise<TagDto[]> {
    const tags = await this.tagsRepository.findAll();
    return tags.map(toDto);
  }

  async create(data: CreateTagData): Promise<TagDto> {
    const existing = await this.tagsRepository.findByName(data.name);
    if (existing) throw new ConflictError("A tag with this name already exists");
    const tag = await this.tagsRepository.create(data);
    return toDto(tag);
  }

  async update(id: string, data: UpdateTagData): Promise<TagDto> {
    const existing = await this.tagsRepository.findById(id);
    if (!existing) throw new NotFoundError("Tag not found");
    if (data.name) {
      const duplicate = await this.tagsRepository.findByName(data.name);
      if (duplicate && duplicate.id !== id) throw new ConflictError("A tag with this name already exists");
    }
    const tag = await this.tagsRepository.update(id, data);
    return toDto(tag);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.tagsRepository.findById(id);
    if (!existing) throw new NotFoundError("Tag not found");
    await this.tagsRepository.delete(id);
  }
}
