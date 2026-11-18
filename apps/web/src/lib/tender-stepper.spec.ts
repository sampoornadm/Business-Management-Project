import { describe, expect, it } from "vitest";

import { canRevertTo } from "./tender-stepper";

describe("canRevertTo", () => {
  it("allows stepping back to the previous stage", () => {
    expect(canRevertTo("SUBMITTED", "DRAFT")).toBe(true);
    expect(canRevertTo("WON", "SUBMITTED")).toBe(true);
    expect(canRevertTo("CANCELLED", "DRAFT")).toBe(true);
  });

  it("treats Price opened as a stage between Submitted and the result", () => {
    expect(canRevertTo("PRICE_OPENED", "SUBMITTED")).toBe(true);
    expect(canRevertTo("WON", "PRICE_OPENED")).toBe(true);
    expect(canRevertTo("LOST", "PRICE_OPENED")).toBe(true);
    expect(canRevertTo("SUBMITTED", "PRICE_OPENED")).toBe(false);
    expect(canRevertTo("PRICE_OPENED", "WON")).toBe(false);
  });

  it("refuses forward moves and reversals the transition table doesn't allow", () => {
    expect(canRevertTo("DRAFT", "SUBMITTED")).toBe(false);
    expect(canRevertTo("WON", "DRAFT")).toBe(false);
    expect(canRevertTo("SUBMITTED", "SUBMITTED")).toBe(false);
  });
});
