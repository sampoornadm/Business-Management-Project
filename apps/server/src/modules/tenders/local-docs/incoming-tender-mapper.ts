import type { TenderExtractionFields } from "@bmp/types";

import type { CreateTenderData } from "../tenders.repository.js";

/** Fields worth telling the user to go and fill in, when the document didn't state them. */
const REVIEW_FIELDS = [
  "submissionDate",
  "department",
  "type",
  "category",
  "location",
  "state",
  "estimatedCost",
] as const;

function buildRemarksNote(fields: TenderExtractionFields): string {
  const missing = REVIEW_FIELDS.filter((key) => fields[key] === undefined);
  const prefix =
    missing.length > 0
      ? `[Auto-created from incoming-tenders ingestion. Left blank — not stated in the source document, fill in before finalizing: ${missing.join(", ")}.]\n\n`
      : "[Auto-created from incoming-tenders ingestion.]\n\n";
  return prefix + (fields.remarks ?? "");
}

/**
 * Returns null only when tenderNumber is missing — it's the tender's identity and its unique
 * key, so there's nothing to create without it.
 *
 * Everything else is passed through as-is, blank included. Nothing is invented: an RFx often
 * states no submission deadline (the source PDFs carry a literal "00.00.0000" placeholder),
 * and this used to hard-refuse those documents while simultaneously writing "Not specified"
 * and estimatedCost 0 for other missing fields. A fabricated 0 cost reads as real data and is
 * more dangerous than an empty cell; every field here is editable after creation.
 */
export function buildDraftTenderData(
  fields: TenderExtractionFields,
  businessId: string,
  createdById: string,
): Omit<CreateTenderData, "clientId"> | null {
  if (!fields.tenderNumber) return null;

  return {
    tenderNumber: fields.tenderNumber,
    title: fields.title ?? fields.tenderNumber,
    department: fields.department ?? null,
    type: fields.type ?? null,
    category: fields.category ?? null,
    location: fields.location ?? null,
    state: fields.state ?? null,
    estimatedCost: fields.estimatedCost ?? null,
    emdAmount: fields.emdAmount ?? null,
    tenderFee: fields.tenderFee ?? null,
    documentFee: fields.documentFee ?? null,
    submissionDate: fields.submissionDate ? new Date(fields.submissionDate) : null,
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
