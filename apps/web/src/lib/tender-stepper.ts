import { TENDER_STATUS_LABELS, type TenderStatus } from "@bmp/types";
import type { StepperStep } from "@bmp/ui";

/** The linear "happy path" a tender follows if it isn't lost/cancelled. */
export const TENDER_HAPPY_PATH: TenderStatus[] = [
  "DRAFT",
  "UPCOMING",
  "DOCUMENT_COLLECTION",
  "UNDER_STUDY",
  "BOQ_PREPARATION",
  "RATE_ANALYSIS",
  "APPROVAL_PENDING",
  "SUBMITTED",
  "TECHNICALLY_QUALIFIED",
  "FINANCIALLY_QUALIFIED",
  "WON",
];

export function isOnHappyPath(status: TenderStatus): boolean {
  return TENDER_HAPPY_PATH.includes(status);
}

export function buildTenderSteps(currentStatus: TenderStatus): StepperStep[] {
  const currentIndex = TENDER_HAPPY_PATH.indexOf(currentStatus);
  return TENDER_HAPPY_PATH.map((status, index) => ({
    key: status,
    label: TENDER_STATUS_LABELS[status],
    state: index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming",
  }));
}
