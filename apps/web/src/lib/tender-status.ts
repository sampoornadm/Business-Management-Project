import type { TenderPriority, TenderStatus } from "@bmp/types";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export function tenderStatusBadgeVariant(status: TenderStatus): BadgeVariant {
  switch (status) {
    case "DRAFT":
    case "ARCHIVED":
      return "outline";
    case "LOST":
    case "CANCELLED":
      return "destructive";
    case "SUBMITTED":
    case "TECHNICALLY_QUALIFIED":
    case "FINANCIALLY_QUALIFIED":
    case "WON":
      return "default";
    default:
      return "secondary";
  }
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
