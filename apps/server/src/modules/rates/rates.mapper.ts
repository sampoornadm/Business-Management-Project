import type { HistoricalRateDto } from "@bmp/types";

import type { HistoricalRateWithCreator } from "./rates.repository.js";

export function toHistoricalRateDto(entity: HistoricalRateWithCreator): HistoricalRateDto {
  return {
    id: entity.id,
    category: entity.category,
    itemName: entity.itemName,
    unit: entity.unit,
    rate: entity.rate,
    location: entity.location,
    effectiveDate: entity.effectiveDate.toISOString(),
    sourceTenderId: entity.sourceTenderId,
    notes: entity.notes,
    createdBy: {
      id: entity.createdBy.id,
      firstName: entity.createdBy.firstName,
      lastName: entity.createdBy.lastName,
    },
    createdAt: entity.createdAt.toISOString(),
  };
}
