import { TENDER_STATUS_LABELS } from "@bmp/types";
import type { TenderKind, TenderListItemDto, TenderPriority, TenderStatus } from "@bmp/types";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success";

export function tenderStatusBadgeVariant(status: TenderStatus): BadgeVariant {
  switch (status) {
    case "DRAFT":
      return "outline";
    case "LOST":
    case "CANCELLED":
      return "destructive";
    case "SUBMITTED":
    case "PRICE_OPENED":
      return "secondary";
    case "WON":
      return "success";
  }
}

/** "Won · 1 of 4 items" for a partial win (just "Won" for a whole one), else the plain status label. */
export function tenderStatusText(
  tender: Pick<TenderListItemDto, "status" | "wonItemCount" | "wonItemsTotal">,
): string {
  const label = TENDER_STATUS_LABELS[tender.status];
  const { wonItemCount: count, wonItemsTotal: total } = tender;
  if (tender.status !== "WON" || count === 0 || (total !== null && count >= total)) return label;
  return `${label} · ${total === null ? count : `${count} of ${total}`} ${total === null && count === 1 ? "item" : "items"}`;
}

export function tenderStatusChartColor(status: TenderStatus): string {
  switch (status) {
    case "DRAFT":
      return "hsl(var(--muted-foreground))";
    case "SUBMITTED":
      return "hsl(var(--primary))";
    case "PRICE_OPENED":
      return "hsl(var(--signal))";
    case "WON":
      return "hsl(var(--success))";
    case "LOST":
    case "CANCELLED":
      return "hsl(var(--destructive))";
  }
}

export function tenderKindBadgeVariant(kind: TenderKind): BadgeVariant {
  return kind === "BUDGETARY" ? "secondary" : "outline";
}

export function tenderPriorityBadgeVariant(priority: TenderPriority): BadgeVariant {
  switch (priority) {
    case "LOW":
      return "outline";
    case "MEDIUM":
      return "secondary";
    case "HIGH":
      return "default";
    case "URGENT":
      return "destructive";
  }
}
