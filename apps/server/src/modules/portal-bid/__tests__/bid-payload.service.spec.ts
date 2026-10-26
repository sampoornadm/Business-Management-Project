import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError } from "../../../core/errors/HttpErrors.js";
import { BidPayloadService, type IPortalProfileRepository } from "../bid-payload.service.js";

const BUSINESS_ID = "biz-1";
const TENDER_ID = "tender-1";

type Item = {
  id: string;
  parentId: string | null;
  itemCode: string | null;
  description: string;
  quantity: number | null;
  rate: number | null;
  gstRate: number;
  hsnCode: string | null;
  unitWeightKg: number | null;
  sortOrder: number;
};

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: "i1",
    parentId: null,
    itemCode: "71802001600160",
    description: "GASKET FOR COOLING PLATE FLANGE",
    quantity: 800,
    rate: 17.75,
    gstRate: 18,
    hsnCode: "4016",
    unitWeightKg: 0.0625,
    sortOrder: 1,
    ...overrides,
  };
}

class FakeProfiles implements IPortalProfileRepository {
  answers: Record<string, string> = {};
  async findAnswers() {
    return this.answers;
  }
  async saveAnswers(_b: string, _p: string, answers: Record<string, string>) {
    this.answers = answers;
  }
}

describe("BidPayloadService.buildPayload", () => {
  let items: Item[];
  let notes: string | null;
  let profiles: FakeProfiles;
  let business: Record<string, unknown>;
  let hasBoq: boolean;

  function service() {
    return new BidPayloadService({
      tenders: {
        findById: async () =>
          ({ id: TENDER_ID, tenderNumber: "1400014359", notes, deliveryPeriodDays: 120 }) as never,
      },
      boqs: {
        findCurrentBoq: async () => (hasBoq ? ({ id: "boq-1" } as never) : null),
        findItemsByBoqId: async () => items as never,
      },
      businesses: { findById: async () => business as never },
      portalProfiles: profiles,
    });
  }

  beforeEach(() => {
    items = [item()];
    notes = null;
    hasBoq = true;
    profiles = new FakeProfiles();
    profiles.answers = {
      billingGstin: "19AAACS7062F6Z6",
      gstinRegistrationType: "NORMAL",
      techCommercialValidity: "Yes",
      "techCommercialValidity.comment": "20 days",
    };
    business = {
      id: BUSINESS_ID,
      gstNumber: "19ADIPC4887G1Z9",
      panNumber: "ADIPC4887G",
      udyamRegistrationNumber: "UDYAM-WB-10-0041053",
      address: "29, Strand Road",
      city: "Kolkata",
      pincode: "700001",
      contacts: [{ name: "Soumen Kumar Chatterjee", email: "a@b.in", phone: "9831310959", isPrimary: true }],
    };
  });

  const build = () => service().buildPayload(TENDER_ID, BUSINESS_ID, "SAIL_ISP");
  const answer = (payload: Awaited<ReturnType<typeof build>>, key: string) =>
    payload.answers.find((a) => a.key === key);

  it("prices an item with the intra-state GST split and totals ex-GST", async () => {
    const payload = await build();
    expect(payload.tenderNumber).toBe("1400014359");
    expect(payload.items).toEqual([
      {
        itemCode: "71802001600160",
        description: "GASKET FOR COOLING PLATE FLANGE",
        quantity: 800,
        rate: 17.75,
        cgstPct: 9,
        sgstPct: 9,
        igstPct: 0,
      },
    ]);
    expect(payload.expectedTotal).toBe(14200);
  });

  it("derives HSN, weight and delivery period from the tender", async () => {
    const payload = await build();
    expect(answer(payload, "hsnCode")).toMatchObject({ value: "4016", source: "tender" });
    expect(answer(payload, "consignmentWeight")).toMatchObject({ value: "50 Kg", source: "tender" });
    expect(answer(payload, "deliveryPeriodDays")).toMatchObject({ value: "120", source: "tender" });
  });

  it("takes supplier identity from the business and the rest from the profile", async () => {
    const payload = await build();
    expect(answer(payload, "supplierGstin")).toMatchObject({ value: "19ADIPC4887G1Z9", source: "business" });
    expect(answer(payload, "address")).toMatchObject({ value: "29, Strand Road, Kolkata - 700001" });
    expect(answer(payload, "contactPerson")).toMatchObject({ value: "Soumen Kumar Chatterjee" });
    expect(answer(payload, "gstinRegistrationType")).toMatchObject({ value: "NORMAL", source: "profile" });
    expect(answer(payload, "techCommercialValidity")).toMatchObject({ value: "Yes", comment: "20 days" });
  });

  it("falls back to the profile answer when the business has no value", async () => {
    business.udyamRegistrationNumber = null;
    profiles.answers.udyamNumber = "UDYAM-WB-10-0041053";
    const payload = await build();
    expect(answer(payload, "udyamNumber")).toMatchObject({ value: "UDYAM-WB-10-0041053", source: "profile" });
  });

  it("skips HSN with a warning when no item has a code", async () => {
    items = [item({ hsnCode: null })];
    const payload = await build();
    expect(answer(payload, "hsnCode")).toBeUndefined();
    expect(payload.warnings.some((w) => w.includes("HSN"))).toBe(true);
  });

  it("names the items missing an HSN code when only some have one", async () => {
    items = [item(), item({ id: "i2", itemCode: "5550001", hsnCode: null })];
    const payload = await build();
    expect(answer(payload, "hsnCode")).toMatchObject({ value: "4016" });
    expect(payload.warnings.some((w) => w.includes("5550001") && w.includes("HSN"))).toBe(true);
  });

  it("skips weight with a warning when an item has no unit weight", async () => {
    items = [item({ unitWeightKg: null })];
    const payload = await build();
    expect(answer(payload, "consignmentWeight")).toBeUndefined();
    expect(payload.warnings.some((w) => w.includes("weight"))).toBe(true);
  });

  it("leaves out an item with no rate and says so", async () => {
    items = [item(), item({ id: "i2", itemCode: "999", rate: null })];
    const payload = await build();
    expect(payload.items.map((i) => i.itemCode)).toEqual(["71802001600160"]);
    expect(payload.warnings.some((w) => w.includes("999"))).toBe(true);
  });

  it("does not warn about section rows that only group other items", async () => {
    items = [item({ id: "sec", itemCode: null, rate: null, quantity: null }), item({ parentId: "sec" })];
    const payload = await build();
    expect(payload.items).toHaveLength(1);
    expect(payload.warnings.filter((w) => w.includes("rate"))).toEqual([]);
  });

  it("warns when the tender asks for a shorter delivery than we offer", async () => {
    notes = "Delivery within 90 days of PO.";
    const payload = await build();
    expect(payload.warnings.some((w) => w.includes("tender asks 90 days"))).toBe(true);
  });

  it("refuses to split GST without a billing-party GSTIN", async () => {
    delete profiles.answers.billingGstin;
    await expect(build()).rejects.toThrow(/billing/i);
  });

  it("refuses when the tender has no current BOQ", async () => {
    hasBoq = false;
    await expect(build()).rejects.toBeInstanceOf(NotFoundError);
  });
});
