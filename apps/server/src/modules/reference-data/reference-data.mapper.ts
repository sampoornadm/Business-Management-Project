import type { ReferenceDataImportDto } from "@bmp/types";

import type { ReferenceDataImportRow } from "./reference-data.repository.js";

export function toReferenceDataImportDto(row: ReferenceDataImportRow): ReferenceDataImportDto {
  return {
    id: row.id,
    dataset: row.dataset,
    sourceUrl: row.sourceUrl,
    hsnRowCount: row.hsnRowCount,
    sacRowCount: row.sacRowCount,
    triggeredByName: row.triggeredBy ? `${row.triggeredBy.firstName} ${row.triggeredBy.lastName}` : null,
    importedAt: row.importedAt.toISOString(),
  };
}
