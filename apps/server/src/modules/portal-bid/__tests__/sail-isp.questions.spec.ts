import { describe, expect, it } from "vitest";

import { SAIL_ISP_QUESTIONS } from "../sail-isp.questions.js";

const labels = SAIL_ISP_QUESTIONS.map((q) => q.label);

describe("SAIL_ISP_QUESTIONS", () => {
  it("has unique keys and unique labels", () => {
    expect(new Set(SAIL_ISP_QUESTIONS.map((q) => q.key)).size).toBe(SAIL_ISP_QUESTIONS.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("keeps the portal's own spelling in labels", () => {
    expect(labels).toContain("Enter GSTIN/ ARN");
    expect(labels).toContain(
      "Whether you accept the bid securing declaration as per the format avaialble in standard documents",
    );
    expect(labels).toContain(
      "Whether you accept the non collusive declarartion as per the format available in standard documents.",
    );
  });

  it("stores labels with single plain spaces so one normaliser matches the live page", () => {
    for (const label of labels) {
      expect(label).not.toMatch(/ | {2}/);
      expect(label).toBe(label.trim());
    }
  });

  it("derives only HSN, consignment weight and delivery period from the tender", () => {
    expect(SAIL_ISP_QUESTIONS.filter((q) => q.source === "tender").map((q) => q.key)).toEqual([
      "consignmentWeight",
      "hsnCode",
      "deliveryPeriodDays",
    ]);
  });

  it("takes supplier identity from the business, not the profile", () => {
    const business = SAIL_ISP_QUESTIONS.filter((q) => q.source === "business").map((q) => q.key);
    expect(business).toEqual(
      expect.arrayContaining(["supplierGstin", "panNumber", "udyamNumber", "email", "phone", "mobile", "address", "contactPerson"]),
    );
  });

  it("marks the two validity questions as carrying a comment (e.g. '20 days')", () => {
    expect(SAIL_ISP_QUESTIONS.filter((q) => q.hasComment).map((q) => q.key)).toEqual([
      "techCommercialValidity",
      "priceBidValidity",
    ]);
  });

  it("covers every question the capture showed (51)", () => {
    expect(SAIL_ISP_QUESTIONS).toHaveLength(51);
  });
});
