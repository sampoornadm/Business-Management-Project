export interface ReferenceDataImportDto {
  id: string;
  dataset: string;
  sourceUrl: string;
  hsnRowCount: number;
  sacRowCount: number;
  triggeredByName: string | null;
  importedAt: string;
}
