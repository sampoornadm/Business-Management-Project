import { describe, expect, it } from "vitest";

import type { TenderExtractionFields } from "@bmp/types";

import { buildDraftTenderData } from "../incoming-tender-mapper.js";

const BUSINESS_ID = "business-1";
const CREATED_BY_ID = "system-user-1";

describe("buildDraftTenderData", () => {
  it("returns null when tenderNumber is missing", () => {
    const fields: TenderExtractionFields = { submissionDate: "2026-07-20" };
    expect(buildDraftTenderData(fields, BUSINESS_ID, CREATED_BY_ID)).toBeNull();
  });

  it("returns null when submissionDate is missing", () => {
    const fields: TenderExtractionFields = { tenderNumber: "1400013728" };
    expect(buildDraftTenderData(fields, BUSINESS_ID, CREATED_BY_ID)).toBeNull();
  });

  it("maps every extracted field through unchanged when all are present", () => {
    const fields: TenderExtractionFields = {
      tenderNumber: "1400013728",
      title: "MJ/C04/2026/3699-SLEEVE",
      department: "ISP MATERIAL MANAGEMENT DEPARTMENT",
      type: "Two Part Bid Response",
      category: "Insulation Material",
      location: "Burnpur",
      state: "West Bengal",
      estimatedCost: 250000,
      emdAmount: 5000,
      tenderFee: 500,
      documentFee: 200,
      submissionDate: "2026-07-20T15:00:00",
      openingDate: "2026-07-13",
      validityPeriodDays: 90,
      description: "Procurement of SLEEVE,1MM,FIBER GLASS",
      remarks: "Some remark from the document",
      dealingOfficerName: "Namasri Banerjee",
      dealingOfficerEmail: "namasri.banerjee@mjunction.in",
      dealingOfficerPhone: "9999999999",
    };

    const result = buildDraftTenderData(fields, BUSINESS_ID, CREATED_BY_ID);

    expect(result).not.toBeNull();
    expect(result?.tenderNumber).toBe("1400013728");
    expect(result?.title).toBe("MJ/C04/2026/3699-SLEEVE");
    expect(result?.department).toBe("ISP MATERIAL MANAGEMENT DEPARTMENT");
    expect(result?.category).toBe("Insulation Material");
    expect(result?.location).toBe("Burnpur");
    expect(result?.state).toBe("West Bengal");
    expect(result?.estimatedCost).toBe(250000);
    expect(result?.submissionDate).toEqual(new Date("2026-07-20T15:00:00"));
    expect(result?.openingDate).toEqual(new Date("2026-07-13"));
    expect(result?.dealingOfficerEmail).toBe("namasri.banerjee@mjunction.in");
    expect(result?.businessId).toBe(BUSINESS_ID);
    expect(result?.createdById).toBe(CREATED_BY_ID);
    expect(result?.remarks).toContain("Some remark from the document");
    expect(result?.remarks).not.toContain("Placeholder values");
  });

  it("placeholders every missing-but-required field and lists them in remarks", () => {
    const fields: TenderExtractionFields = {
      tenderNumber: "1400013728",
      submissionDate: "2026-07-20T15:00:00",
    };

    const result = buildDraftTenderData(fields, BUSINESS_ID, CREATED_BY_ID);

    expect(result).not.toBeNull();
    expect(result?.title).toBe("1400013728");
    expect(result?.department).toBe("Not specified");
    expect(result?.type).toBe("Not specified");
    expect(result?.category).toBe("General");
    expect(result?.location).toBe("Not specified");
    expect(result?.state).toBe("Not specified");
    expect(result?.estimatedCost).toBe(0);
    expect(result?.remarks).toContain("Placeholder values");
    expect(result?.remarks).toContain("department");
    expect(result?.remarks).toContain("category");
    expect(result?.remarks).toContain("estimatedCost");
  });
});
