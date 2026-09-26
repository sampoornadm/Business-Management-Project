import { describe, expect, it } from "vitest";

import { daysUntil, deadlineLabel } from "./deadline";

describe("daysUntil", () => {
  it("returns 0 for a deadline later today", () => {
    const now = new Date(2026, 8, 26, 10, 0);
    const due = new Date(2026, 8, 26, 23, 0);
    expect(daysUntil(due, now)).toBe(0);
  });

  it("returns a positive count for a future date", () => {
    const now = new Date(2026, 0, 1);
    const due = new Date(2026, 0, 15);
    expect(daysUntil(due, now)).toBe(14);
  });

  it("returns a negative count for a past date", () => {
    const now = new Date(2026, 0, 15);
    const due = new Date(2026, 0, 10);
    expect(daysUntil(due, now)).toBe(-5);
  });

  it("accepts an ISO date string for the deadline", () => {
    const now = new Date(2026, 0, 1, 8, 0);
    const due = new Date(2026, 0, 1, 20, 0).toISOString();
    expect(daysUntil(due, now)).toBe(0);
  });
});

describe("deadlineLabel", () => {
  it("labels a past deadline as Closed", () => {
    expect(deadlineLabel(-1)).toBe("Closed");
  });

  it("labels zero days as Due today", () => {
    expect(deadlineLabel(0)).toBe("Due today");
  });

  it("labels one day as Due tomorrow", () => {
    expect(deadlineLabel(1)).toBe("Due tomorrow");
  });

  it("labels multiple days as N days left", () => {
    expect(deadlineLabel(5)).toBe("5 days left");
  });
});
