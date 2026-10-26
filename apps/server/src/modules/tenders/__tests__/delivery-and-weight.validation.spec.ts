import { describe, expect, it } from "vitest";

import { updateBoqItemSchema } from "../../boq/boq.validation.js";
import { updateTenderSchema } from "../tenders.validation.js";

describe("deliveryPeriodDays validation", () => {
  it("accepts a whole number of days on tender update", () => {
    expect(updateTenderSchema.parse({ deliveryPeriodDays: 90 }).deliveryPeriodDays).toBe(90);
  });

  it("coerces a numeric string (form submit) to a number", () => {
    expect(updateTenderSchema.parse({ deliveryPeriodDays: "120" }).deliveryPeriodDays).toBe(120);
  });

  it("rejects zero and fractions", () => {
    expect(updateTenderSchema.safeParse({ deliveryPeriodDays: 0 }).success).toBe(false);
    expect(updateTenderSchema.safeParse({ deliveryPeriodDays: 1.5 }).success).toBe(false);
  });
});

describe("unitWeightKg validation", () => {
  it("accepts a positive unit weight on a BOQ item update", () => {
    expect(updateBoqItemSchema.parse({ unitWeightKg: 0.0625 }).unitWeightKg).toBe(0.0625);
  });

  it("rejects zero and negative weights", () => {
    expect(updateBoqItemSchema.safeParse({ unitWeightKg: 0 }).success).toBe(false);
    expect(updateBoqItemSchema.safeParse({ unitWeightKg: -1 }).success).toBe(false);
  });
});
