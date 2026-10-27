import { describe, expect, it } from "vitest";

import { parseDeliveryDaysFromNotes } from "../tender-delivery-days.parser.js";

describe("parseDeliveryDaysFromNotes", () => {
  it("reads days", () => {
    expect(parseDeliveryDaysFromNotes("Delivery within 45 days of PO")).toBe(45);
  });

  it("converts weeks to days", () => {
    expect(parseDeliveryDaysFromNotes("Delivery period: 8 weeks")).toBe(56);
  });

  it("converts months to days", () => {
    expect(parseDeliveryDaysFromNotes("Material to be delivered within 2 months from the date of order")).toBe(60);
  });

  it("ignores a payment term that merely mentions delivery", () => {
    expect(parseDeliveryDaysFromNotes("Payment within 30 days of delivery")).toBeNull();
  });

  it("returns null when notes are empty or missing", () => {
    expect(parseDeliveryDaysFromNotes(null)).toBeNull();
    expect(parseDeliveryDaysFromNotes("")).toBeNull();
  });

  it("returns null when no delivery period is stated", () => {
    expect(parseDeliveryDaysFromNotes("Bidders must quote GST separately.\nEMD is mandatory.")).toBeNull();
  });

  it("takes the shortest when several periods are stated", () => {
    expect(
      parseDeliveryDaysFromNotes("Delivery within 60 days for item 1.\nDelivery within 30 days for item 2."),
    ).toBe(30);
  });

  it("reads a number written out in brackets after the digits", () => {
    expect(parseDeliveryDaysFromNotes("Delivery within 30 (thirty) days from PO")).toBe(30);
  });

  it("keeps a delivery clause that shares a line with a payment clause", () => {
    expect(parseDeliveryDaysFromNotes("Delivery: 4 weeks from PO, Payment: 100% within 30 days")).toBe(28);
  });

  it("does not split a decimal number into two sentences", () => {
    expect(parseDeliveryDaysFromNotes("Delivery within 1.5 months of order")).toBe(45);
  });
});
