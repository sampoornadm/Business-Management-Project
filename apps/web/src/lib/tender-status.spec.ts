import { describe, expect, it } from "vitest";

import { tenderPriorityBadgeVariant, tenderStatusBadgeVariant } from "./tender-status";

describe("tenderStatusBadgeVariant", () => {
  it("returns outline for draft", () => {
    expect(tenderStatusBadgeVariant("DRAFT")).toBe("outline");
  });

  it("returns destructive for lost/cancelled states", () => {
    expect(tenderStatusBadgeVariant("LOST")).toBe("destructive");
    expect(tenderStatusBadgeVariant("CANCELLED")).toBe("destructive");
  });

  it("returns default for submitted-and-beyond states", () => {
    expect(tenderStatusBadgeVariant("SUBMITTED")).toBe("default");
    expect(tenderStatusBadgeVariant("WON")).toBe("default");
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
