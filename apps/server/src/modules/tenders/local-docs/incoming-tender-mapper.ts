import type { TenderExtractionFields } from "@bmp/types";

import type { CreateTenderData } from "../tenders.repository.js";

const PLACEHOLDER_FIELDS = [
  "department",
  "type",
  "category",
  "location",
  "state",
  "estimatedCost",
] as const;

function buildRemarksNote(fields: TenderExtractionFields): string {
  const placeholdered = PLACEHOLDER_FIELDS.filter((key) => fields[key] === undefined);
  const prefix =
    placeholdered.length > 0
      ? `[Auto-created from incoming-tenders ingestion. Placeholder values — verify before finalizing: ${placeholdered.join(", ")}.]\n\n`
      : "[Auto-created from incoming-tenders ingestion.]\n\n";
  return prefix + (fields.remarks ?? "");
}

// Returns null when tenderNumber or submissionDate is missing — these two are never
// guessed (see the plan's Global Constraints); the caller leaves the source file in
// place for manual handling instead of creating a tender with a fabricated number or
// deadline.
export function buildDraftTenderData(
  fields: TenderExtractionFields,
  businessId: string,
  createdById: string,
): Omit<CreateTenderData, "clientId"> | null {
  if (!fields.tenderNumber || !fields.submissionDate) return null;

  return {
    tenderNumber: fields.tenderNumber,
    title: fields.title ?? fields.tenderNumber,
    department: fields.department ?? "Not specified",
    type: fields.type ?? "Not specified",
    category: fields.category ?? "General",
    location: fields.location ?? "Not specified",
    state: fields.state ?? "Not specified",
    estimatedCost: fields.estimatedCost ?? 0,
    emdAmount: fields.emdAmount ?? null,
    tenderFee: fields.tenderFee ?? null,
    documentFee: fields.documentFee ?? null,
    submissionDate: new Date(fields.submissionDate),
    openingDate: fields.openingDate ? new Date(fields.openingDate) : null,
    validityPeriodDays: fields.validityPeriodDays ?? null,
    description: fields.description ?? null,
    remarks: buildRemarksNote(fields),
    dealingOfficerName: fields.dealingOfficerName ?? null,
    dealingOfficerEmail: fields.dealingOfficerEmail ?? null,
    dealingOfficerPhone: fields.dealingOfficerPhone ?? null,
    businessId,
    createdById,
  };
}
