import type { SavedViewDto } from "@bmp/types";

import { ForbiddenError, NotFoundError } from "../../core/errors/HttpErrors.js";

import type { CreateSavedViewData, ISavedViewsRepository, UpdateSavedViewData } from "./saved-views.repository.js";
import { toSavedViewDto } from "./saved-views.mapper.js";

export class SavedViewsService {
  constructor(private readonly savedViewsRepository: ISavedViewsRepository) {}

  async list(userId: string, businessId: string, pageKey: string): Promise<SavedViewDto[]> {
    const views = await this.savedViewsRepository.findMany(userId, businessId, pageKey);
    return views.map(toSavedViewDto);
  }

  async create(data: CreateSavedViewData): Promise<SavedViewDto> {
    const view = await this.savedViewsRepository.create(data);
    return toSavedViewDto(view);
  }

  private async assertOwnedView(id: string, userId: string, businessId: string) {
    const view = await this.savedViewsRepository.findById(id, businessId);
    if (!view) throw new NotFoundError("Saved view not found");
    if (view.userId !== userId) throw new ForbiddenError("You cannot modify another user's saved view");
    return view;
  }

  async update(
    id: string,
    userId: string,
    businessId: string,
    data: UpdateSavedViewData,
  ): Promise<SavedViewDto> {
    await this.assertOwnedView(id, userId, businessId);
    const updated = await this.savedViewsRepository.update(id, data);
    return toSavedViewDto(updated);
  }

  async delete(id: string, userId: string, businessId: string): Promise<void> {
    await this.assertOwnedView(id, userId, businessId);
    await this.savedViewsRepository.delete(id);
  }
}
