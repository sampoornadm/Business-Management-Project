import { Badge, type BadgeProps } from "@bmp/ui";

type Tone = NonNullable<BadgeProps["variant"]>;

/**
 * One colour meaning for every status in the app, whichever record it belongs to:
 * outline = not started, secondary = in progress, success = done, destructive = stopped or late.
 * A status missing from this map still renders (as "in progress" grey) — add it here, not in a page.
 */
const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "outline",
  PENDING: "outline",
  UNPAID: "outline",
  INVITED: "outline",

  SENT: "secondary",
  ISSUED: "secondary",
  SUBMITTED: "secondary",
  APPROVED: "secondary",
  IN_PROGRESS: "secondary",
  ON_HOLD: "secondary",
  PARTIALLY_RECEIVED: "secondary",
  PARTIALLY_PAID: "secondary",

  ACTIVE: "success",
  WON: "success",
  PAID: "success",
  RECEIVED: "success",
  COMPLETED: "success",
  CLOSED: "success",
  QUOTED: "success",

  CANCELLED: "destructive",
  LOST: "destructive",
  OVERDUE: "destructive",
  DELAYED: "destructive",
  DECLINED: "destructive",
};

/** "PARTIALLY_RECEIVED" -> "Partially received". For any stored code shown to a person. */
export function humanize(code: string): string {
  const words = code.replaceAll("_", " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={STATUS_TONE[status] ?? "secondary"} className={className}>
      {humanize(status)}
    </Badge>
  );
}
