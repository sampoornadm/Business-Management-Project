import { describe, expect, it } from "vitest";

import { tenderPriorityBadgeVariant, tenderStatusBadgeVariant } from "./tender-status";

describe("tenderStatusBadgeVariant", () => {
  it("returns outline for draft/archived states", () => {
    expect(tenderStatusBadgeVariant("DRAFT")).toBe("outline");
    expect(tenderStatusBadgeVariant("ARCHIVED")).toBe("outline");
  });

  it("returns destructive for lost/cancelled states", () => {
    expect(tenderStatusBadgeVariant("LOST")).toBe("destructive");
    expect(tenderStatusBadgeVariant("CANCELLED")).toBe("destructive");
  });

  it("returns default for submitted-and-beyond states", () => {
    expect(tenderStatusBadgeVariant("SUBMITTED")).toBe("default");
    expect(tenderStatusBadgeVariant("WON")).toBe("default");
  });

  it("returns secondary for in-progress states", () => {
    expect(tenderStatusBadgeVariant("UNDER_STUDY")).toBe("secondary");
  });
});

describe("tenderPriorityBadgeVariant", () => {
  it("maps each priority to its badge variant", () => {
    expect(tenderPriorityBadgeVariant("LOW")).toBe("outline");
    expect(tenderPriorityBadgeVariant("MEDIUM")).toBe("secondary");
    expect(tenderPriorityBadgeVariant("HIGH")).toBe("default");
    expect(tenderPriorityBadgeVariant("URGENT")).toBe("destructive");
  });
});
