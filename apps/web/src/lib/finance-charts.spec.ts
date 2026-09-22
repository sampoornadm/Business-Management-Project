import type { CashBookEntryDto, ExpenseListItemDto, InvoiceListItemDto } from "@bmp/types";
import { describe, expect, it } from "vitest";

import {
  buildCashFlowMonths,
  formatCompact,
  humanizeEnum,
  sumExpensesByCategory,
  sumInvoicesByStatus,
} from "./finance-charts";

const entry = (direction: "RECEIVED" | "PAID", amount: number, paymentDate: string): CashBookEntryDto =>
  ({ direction, amount, paymentDate }) as CashBookEntryDto;

const invoice = (status: InvoiceListItemDto["status"], totalAmount: number): InvoiceListItemDto =>
  ({ status, totalAmount }) as InvoiceListItemDto;

const expense = (category: ExpenseListItemDto["category"], amount: number, amountPaid: number): ExpenseListItemDto =>
  ({ category, amount, amountPaid }) as ExpenseListItemDto;

describe("humanizeEnum", () => {
  it("formats enum values for display", () => {
    expect(humanizeEnum("PARTIALLY_PAID")).toBe("Partially paid");
    expect(humanizeEnum("MATERIAL")).toBe("Material");
  });
});

describe("buildCashFlowMonths", () => {
  const now = new Date(2026, 8, 22); // 22 Sep 2026, local

  it("returns the last N months oldest-first with zero-filled gaps", () => {
    const months = buildCashFlowMonths([], now, 6);
    expect(months.map((m) => m.key)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(months.every((m) => m.received === 0 && m.paid === 0 && m.net === 0)).toBe(true);
    expect(months[5]!.label).toMatch(/Sep/);
  });

  it("spans a year boundary", () => {
    const keys = buildCashFlowMonths([], new Date(2026, 1, 10), 4).map((m) => m.key);
    expect(keys).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("sums money in and out per month and derives net", () => {
    const months = buildCashFlowMonths(
      [
        entry("RECEIVED", 1000.1, new Date(2026, 8, 3).toISOString()),
        entry("RECEIVED", 500.2, new Date(2026, 8, 20).toISOString()),
        entry("PAID", 300, new Date(2026, 8, 5).toISOString()),
        entry("PAID", 90, new Date(2026, 7, 31).toISOString()),
      ],
      now,
    );
    expect(months.find((m) => m.key === "2026-09")).toMatchObject({ received: 1500.3, paid: 300, net: 1200.3 });
    expect(months.find((m) => m.key === "2026-08")).toMatchObject({ received: 0, paid: 90, net: -90 });
  });

  it("ignores payments outside the window", () => {
    const months = buildCashFlowMonths([entry("RECEIVED", 999, new Date(2025, 0, 1).toISOString())], now);
    expect(months.reduce((sum, m) => sum + m.received, 0)).toBe(0);
  });
});

describe("sumInvoicesByStatus", () => {
  it("totals value per status in a stable order and skips empty statuses", () => {
    const slices = sumInvoicesByStatus([
      invoice("DRAFT", 10),
      invoice("PAID", 100.5),
      invoice("PAID", 50.25),
      invoice("OVERDUE", 70),
    ]);
    expect(slices.map((s) => [s.status, s.count, s.amount])).toEqual([
      ["PAID", 2, 150.75],
      ["OVERDUE", 1, 70],
      ["DRAFT", 1, 10],
    ]);
    expect(slices[0]).toMatchObject({ label: "Paid", color: "hsl(var(--success))" });
  });

  it("returns nothing for no invoices", () => {
    expect(sumInvoicesByStatus([])).toEqual([]);
  });
});

describe("sumExpensesByCategory", () => {
  it("splits paid vs outstanding per category, biggest first", () => {
    const bars = sumExpensesByCategory([
      expense("MATERIAL", 1000, 400),
      expense("MATERIAL", 500, 500),
      expense("LABOR", 3000, 0),
    ]);
    expect(bars).toEqual([
      { category: "LABOR", label: "Labor", paid: 0, outstanding: 3000, total: 3000 },
      { category: "MATERIAL", label: "Material", paid: 900, outstanding: 600, total: 1500 },
    ]);
  });

  it("never lets an overpayment produce a negative outstanding", () => {
    expect(sumExpensesByCategory([expense("OFFICE", 100, 150)])[0]).toMatchObject({ paid: 100, outstanding: 0 });
  });
});

describe("formatCompact", () => {
  it("shortens large values for axis labels", () => {
    expect(formatCompact(1_600_000)).toMatch(/16\s?L/);
    expect(formatCompact(950)).toBe("950");
  });
});
