import type { TenderSubmissionLineDto } from "@bmp/types";
import { describe, expect, it } from "vitest";

import {
  diffSubmissions,
  formatInr,
  renderSubmissionSummary,
  type SubmissionSnapshot,
} from "../submission-diff.js";

function line(overrides: Partial<TenderSubmissionLineDto> & { boqItemId: string; description: string }): TenderSubmissionLineDto {
  return {
    unit: "nos",
    quantity: 10,
    rate: 100,
    amount: 1000,
    baseRate: null,
    markupPercent: null,
    vendorId: null,
    vendorName: null,
    hsnCode: null,
    technicalDeviation: null,
    ...overrides,
  };
}

function snapshot(reference: string | null, totalAmount: number, lines: TenderSubmissionLineDto[]): SubmissionSnapshot {
  return { reference, totalAmount, lines };
}

function render(number: number, current: SubmissionSnapshot, previous: SubmissionSnapshot | null): string {
  return renderSubmissionSummary(
    number,
    current,
    previous ? { number: number - 1, snapshot: previous, changes: diffSubmissions(previous, current) } : null,
  );
}

const twoLines = [line({ boqItemId: "a", description: "A" }), line({ boqItemId: "b", description: "B" })];

describe("formatInr", () => {
  it("uses Indian digit grouping", () => {
    expect(formatInr(1240000, 0)).toBe("₹12,40,000");
    expect(formatInr(437, 2)).toBe("₹437.00");
  });
});

describe("renderSubmissionSummary", () => {
  it("first submission summary", () => {
    expect(render(1, snapshot("ABC/123", 1240000, twoLines), null)).toBe(
      "Submission #1 · ref ABC/123 · 2 items · total ₹12,40,000",
    );
  });

  it("budgetary first submission has no ref segment", () => {
    expect(render(1, snapshot(null, 2000, twoLines), null)).toBe("Submission #1 · 2 items · total ₹2,000");
  });

  it("reports rate, vendor and markup change in one bullet", () => {
    const before = snapshot("ABC/123", 4370, [
      line({ boqItemId: "a", description: "XLPE Cable 4C×16", rate: 437, baseRate: 380, markupPercent: 15, vendorId: "v1", vendorName: "Polycab Traders" }),
    ]);
    const after = snapshot("ABC/123", 4370, [
      line({ boqItemId: "a", description: "XLPE Cable 4C×16", rate: 415, baseRate: 360.87, markupPercent: 15, vendorId: "v2", vendorName: "Havells Dist." }),
    ]);

    expect(render(2, after, before)).toContain(
      "Rates changed (1):\n• XLPE Cable 4C×16 — ₹437.00 → ₹415.00 · Polycab Traders → Havells Dist. · markup 15% → 15%",
    );
  });

  it("reports HSN, deviation, quantity, added and removed", () => {
    const before = snapshot("R", 0, [
      line({ boqItemId: "x", description: "XLPE", hsnCode: "8544" }),
      line({ boqItemId: "g", description: "GI Pipe 50mm", unit: "m", quantity: 120 }),
      line({ boqItemId: "t", description: "Cable tray 300mm" }),
    ]);
    const after = snapshot("R", 0, [
      line({ boqItemId: "x", description: "XLPE", hsnCode: "85444999", technicalDeviation: "Make KEI instead of Polycab" }),
      line({ boqItemId: "g", description: "GI Pipe 50mm", unit: "m", quantity: 140 }),
      line({ boqItemId: "c", description: "Cable gland 25mm" }),
    ]);

    const summary = render(2, after, before);

    expect(summary).toContain("HSN changed (1):\n• XLPE — 8544 → 85444999");
    expect(summary).toContain('Technical deviation changed (1):\n• XLPE — none → "Make KEI instead of Polycab"');
    expect(summary).toContain("Quantity changed (1):\n• GI Pipe 50mm — 120 → 140 m");
    expect(summary).toContain("Added (1):\n• Cable gland 25mm");
    expect(summary).toContain("Removed (1):\n• Cable tray 300mm");
    expect(summary).not.toContain("Rates changed");
  });

  it("reference and total change in header", () => {
    const summary = render(2, snapshot("ABC/124", 1195500, twoLines), snapshot("ABC/123", 1240000, twoLines));

    expect(summary.split("\n")[0]).toBe("Submission #2 · ref ABC/124 (was ABC/123) · total ₹11,95,500 (was ₹12,40,000)");
  });

  it("no changes", () => {
    const same = snapshot("ABC/123", 2000, twoLines);

    expect(render(2, same, same)).toBe("Submission #2 · ref ABC/123 · total ₹2,000\nNo changes since #1");
  });
});

describe("diffSubmissions", () => {
  it("matches re-uploaded lines by description + unit", () => {
    const before = snapshot("R", 0, [line({ boqItemId: "a", description: "A" }), line({ boqItemId: "b", description: "B" })]);
    const after = snapshot("R", 0, [line({ boqItemId: "x", description: "A" }), line({ boqItemId: "y", description: "B", rate: 120 })]);

    const changes = diffSubmissions(before, after);

    expect(changes.lines).toHaveLength(1);
    expect(changes.lines[0]!.changed).toEqual(["rate"]);
    expect(changes.added).toEqual([]);
    expect(changes.removed).toEqual([]);
  });

  it("pairs duplicate description + unit lines one-to-one", () => {
    const before = snapshot("R", 0, [line({ boqItemId: "a", description: "Bolt M8" }), line({ boqItemId: "b", description: "Bolt M8" })]);
    const after = snapshot("R", 0, [line({ boqItemId: "x", description: "Bolt M8" }), line({ boqItemId: "y", description: "Bolt M8" })]);

    const changes = diffSubmissions(before, after);

    expect(changes).toEqual({ reference: null, total: null, lines: [], added: [], removed: [] });
  });
});
