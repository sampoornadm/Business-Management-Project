import { TENDER_STATUS_LABELS, type TenderStatus } from "@bmp/types";
import type { StepperStep } from "@bmp/ui";

/** The linear "happy path" a tender follows if it isn't lost/cancelled. */
export const TENDER_HAPPY_PATH: TenderStatus[] = ["DRAFT", "SUBMITTED", "WON"];

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
