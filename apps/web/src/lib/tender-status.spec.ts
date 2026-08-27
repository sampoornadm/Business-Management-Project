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

  it("returns secondary for submitted, success for won", () => {
    expect(tenderStatusBadgeVariant("SUBMITTED")).toBe("secondary");
    expect(tenderStatusBadgeVariant("WON")).toBe("success");
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
