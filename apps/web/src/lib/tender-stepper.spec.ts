import { describe, expect, it } from "vitest";

import { buildTenderSteps, isOnHappyPath, TENDER_HAPPY_PATH } from "./tender-stepper";

describe("isOnHappyPath", () => {
  it("returns true for a status on the linear happy path", () => {
    expect(isOnHappyPath("SUBMITTED")).toBe(true);
  });

  it("returns false for a terminal off-path status", () => {
    expect(isOnHappyPath("LOST")).toBe(false);
    expect(isOnHappyPath("CANCELLED")).toBe(false);
  });
});

describe("buildTenderSteps", () => {
  it("marks steps before the current status as complete, the current as current, and the rest upcoming", () => {
    const steps = buildTenderSteps("SUBMITTED");
    const currentIndex = TENDER_HAPPY_PATH.indexOf("SUBMITTED");

    expect(steps).toHaveLength(TENDER_HAPPY_PATH.length);
    steps.forEach((step, index) => {
      if (index < currentIndex) expect(step.state).toBe("complete");
      else if (index === currentIndex) expect(step.state).toBe("current");
      else expect(step.state).toBe("upcoming");
    });
  });

  it("marks every step complete except the last when the tender is WON", () => {
    const steps = buildTenderSteps("WON");
    expect(steps[steps.length - 1]!.state).toBe("current");
    expect(steps.slice(0, -1).every((s) => s.state === "complete")).toBe(true);
  });
});
