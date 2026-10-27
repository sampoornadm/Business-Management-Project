import { isTenderStatusReversal, TENDER_STATUS_TRANSITIONS, type TenderStatus } from "@bmp/types";

/** Whether clicking the earlier `target` stage's circle is a legal admin move back from `current`. */
export function canRevertTo(current: TenderStatus, target: TenderStatus): boolean {
  return isTenderStatusReversal(current, target) && TENDER_STATUS_TRANSITIONS[current].includes(target);
}
