import { describe, expect, it } from "vitest";

import { daysUntil, isPastDue, timeLeftLabel } from "./deadline";

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

describe("timeLeftLabel", () => {
  const now = new Date(2026, 8, 26, 10, 0);

  it("labels Closed once the exact time has passed, even on the same calendar day", () => {
    expect(timeLeftLabel(new Date(2026, 8, 26, 9, 59), now)).toBe("Closed");
  });

  it("counts minutes inside the last hour", () => {
    expect(timeLeftLabel(new Date(2026, 8, 26, 10, 20), now)).toBe("20 min left");
  });

  it("counts hours inside the last 24 hours, even when the date is tomorrow", () => {
    expect(timeLeftLabel(new Date(2026, 8, 26, 15, 30), now)).toBe("5 hours left");
    expect(timeLeftLabel(new Date(2026, 8, 26, 11, 0), now)).toBe("1 hour left");
    expect(timeLeftLabel(new Date(2026, 8, 27, 8, 0), now)).toBe("22 hours left");
  });

  it("labels the next calendar day as Due tomorrow once it is over 24 hours away", () => {
    expect(timeLeftLabel(new Date(2026, 8, 27, 17, 0), now)).toBe("Due tomorrow");
  });

  it("counts calendar days beyond that", () => {
    expect(timeLeftLabel(new Date(2026, 9, 1, 9, 0), now)).toBe("5 days left");
  });
});
