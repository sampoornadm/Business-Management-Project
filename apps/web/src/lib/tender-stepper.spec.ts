import { describe, expect, it } from "vitest";

import { canRevertTo } from "./tender-stepper";

describe("canRevertTo", () => {
  it("allows stepping back to the previous stage", () => {
    expect(canRevertTo("SUBMITTED", "DRAFT")).toBe(true);
    expect(canRevertTo("WON", "SUBMITTED")).toBe(true);
    expect(canRevertTo("CANCELLED", "DRAFT")).toBe(true);
  });

  it("refuses forward moves and reversals the transition table doesn't allow", () => {
    expect(canRevertTo("DRAFT", "SUBMITTED")).toBe(false);
    expect(canRevertTo("WON", "DRAFT")).toBe(false);
    expect(canRevertTo("SUBMITTED", "SUBMITTED")).toBe(false);
  });
});
