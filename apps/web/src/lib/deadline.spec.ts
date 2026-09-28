import { describe, expect, it } from "vitest";

import { daysUntil, deadlineLabel, isPastDue } from "./deadline";

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

describe("isPastDue", () => {
  it("is false when the deadline is later today", () => {
    const now = new Date(2026, 8, 26, 10, 0);
    const due = new Date(2026, 8, 26, 15, 0);
    expect(isPastDue(due, now)).toBe(false);
  });

  it("is true once the deadline's exact time has passed, even on the same calendar day", () => {
    const now = new Date(2026, 8, 26, 19, 0);
    const due = new Date(2026, 8, 26, 15, 0);
    expect(isPastDue(due, now)).toBe(true);
  });

  it("is true for a date entirely in the past", () => {
    const now = new Date(2026, 8, 26);
    const due = new Date(2026, 8, 20);
    expect(isPastDue(due, now)).toBe(true);
  });

  it("is false for a date entirely in the future", () => {
    const now = new Date(2026, 8, 26);
    const due = new Date(2026, 9, 10);
    expect(isPastDue(due, now)).toBe(false);
  });
});

describe("deadlineLabel", () => {
  it("labels Closed once the deadline has passed, even same-day with daysLeft still 0", () => {
    expect(deadlineLabel(0, true)).toBe("Closed");
  });

  it("labels a past calendar day as Closed", () => {
    expect(deadlineLabel(-1, true)).toBe("Closed");
  });

  it("labels zero days as Due today when the deadline hasn't passed yet", () => {
    expect(deadlineLabel(0, false)).toBe("Due today");
  });

  it("labels one day as Due tomorrow", () => {
    expect(deadlineLabel(1, false)).toBe("Due tomorrow");
  });

  it("labels multiple days as N days left", () => {
    expect(deadlineLabel(5, false)).toBe("5 days left");
  });
});
