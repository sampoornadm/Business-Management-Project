import type { TenderPriority, TenderStatus } from "@bmp/types";

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success";

export function tenderStatusBadgeVariant(status: TenderStatus): BadgeVariant {
  switch (status) {
    case "DRAFT":
      return "outline";
    case "LOST":
    case "CANCELLED":
      return "destructive";
    case "SUBMITTED":
      return "secondary";
    case "WON":
      return "success";
  }
}

export function tenderStatusChartColor(status: TenderStatus): string {
  switch (status) {
    case "DRAFT":
      return "hsl(var(--muted-foreground))";
    case "SUBMITTED":
      return "hsl(var(--primary))";
    case "WON":
      return "hsl(var(--success))";
    case "LOST":
    case "CANCELLED":
      return "hsl(var(--destructive))";
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
