import type {
  CashBookEntryDto,
  ExpenseCategory,
  ExpenseListItemDto,
  InvoiceListItemDto,
  InvoiceStatus,
} from "@bmp/types";

import { CHART_COLORS } from "./chart-colors";

/** "PARTIALLY_PAID" -> "Partially paid". */
export function humanizeEnum(value: string): string {
  const spaced = value.toLowerCase().replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ---------- cash flow ----------

export interface CashFlowMonth {
  /** "2026-09" — local calendar month. */
  key: string;
  label: string;
  received: number;
  paid: number;
  net: number;
}

const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Money in vs out per calendar month for the last `monthCount` months (oldest first, ending with
 * the month of `now`). Months without payments are present as zeros so the chart axis is continuous.
 */
export function buildCashFlowMonths(entries: readonly CashBookEntryDto[], now: Date, monthCount = 6): CashFlowMonth[] {
  const buckets = new Map<string, CashFlowMonth>();
  for (let back = monthCount - 1; back >= 0; back--) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
    buckets.set(monthKey(d), {
      key: monthKey(d),
      label: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
      received: 0,
      paid: 0,
      net: 0,
    });
  }
  for (const entry of entries) {
    const bucket = buckets.get(monthKey(new Date(entry.paymentDate)));
    if (!bucket) continue;
    if (entry.direction === "RECEIVED") bucket.received += entry.amount;
    else bucket.paid += entry.amount;
  }
  return [...buckets.values()].map((b) => ({
    ...b,
    received: round2(b.received),
    paid: round2(b.paid),
    net: round2(b.received - b.paid),
  }));
}

// ---------- invoices ----------

const INVOICE_STATUS_ORDER: readonly InvoiceStatus[] = ["PAID", "PARTIALLY_PAID", "SENT", "OVERDUE", "DRAFT"];

// Never pairs the theme's `primary` with `signal`: some business themes are amber, where those two
// are near-identical and adjacent donut slices would blur together.
export const INVOICE_STATUS_CHART_COLOR: Record<InvoiceStatus, string> = {
  PAID: CHART_COLORS.success,
  PARTIALLY_PAID: CHART_COLORS.primary,
  SENT: CHART_COLORS.muted,
  OVERDUE: CHART_COLORS.destructive,
  DRAFT: "hsl(var(--muted-foreground) / 0.4)",
};

export interface InvoiceStatusSlice {
  status: InvoiceStatus;
  label: string;
  count: number;
  amount: number;
  color: string;
}

/** Invoice value per status, in a stable order, skipping statuses with no invoices. */
export function sumInvoicesByStatus(invoices: readonly InvoiceListItemDto[]): InvoiceStatusSlice[] {
  return INVOICE_STATUS_ORDER.flatMap((status) => {
    const matching = invoices.filter((i) => i.status === status);
    if (matching.length === 0) return [];
    return [
      {
        status,
        label: humanizeEnum(status),
        count: matching.length,
        amount: round2(matching.reduce((sum, i) => sum + i.totalAmount, 0)),
        color: INVOICE_STATUS_CHART_COLOR[status],
      },
    ];
  });
}

// ---------- expenses ----------

export interface ExpenseCategoryBar {
  category: ExpenseCategory;
  label: string;
  paid: number;
  outstanding: number;
  total: number;
}

/** Expense totals per category, split into paid / still owed, biggest first. */
export function sumExpensesByCategory(expenses: readonly ExpenseListItemDto[]): ExpenseCategoryBar[] {
  const byCategory = new Map<ExpenseCategory, ExpenseCategoryBar>();
  for (const expense of expenses) {
    const bar = byCategory.get(expense.category) ?? {
      category: expense.category,
      label: humanizeEnum(expense.category),
      paid: 0,
      outstanding: 0,
      total: 0,
    };
    const paid = Math.min(expense.amountPaid, expense.amount);
    bar.paid += paid;
    bar.outstanding += expense.amount - paid;
    bar.total += expense.amount;
    byCategory.set(expense.category, bar);
  }
  return [...byCategory.values()]
    .map((b) => ({ ...b, paid: round2(b.paid), outstanding: round2(b.outstanding), total: round2(b.total) }))
    .sort((a, b) => b.total - a.total);
}

// ---------- axis / tooltip formatting ----------

const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
/** Short axis labels ("16L", "1.2Cr") — full precision stays in tooltips and the cards. */
export const formatCompact = (value: number): string => compact.format(value);
