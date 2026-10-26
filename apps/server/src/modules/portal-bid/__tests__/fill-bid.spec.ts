import { beforeEach, describe, expect, it, vi } from "vitest";

import { fillBid, type IPortalSession } from "../portal/fill-bid.js";
import type { PortalHeader } from "../portal/portal-session.js";
import type { BidPayload } from "../portal-bid.types.js";

const GSTIN_LABEL = "Enter GSTIN/ ARN";
const PAN_LABEL = "Tenderer PAN Number";

class FakeSession implements IPortalSession {
  header: PortalHeader = {
    responseNumber: "8100095724",
    rfxNumber: "1400014359",
    deadline: "27.10.2026 15:00:00 INDIA",
    totalValue: "14,200.00 INR",
  };
  fields = new Map<string, string>();
  comments = new Map<string, string>();
  conditions = new Map<string, Record<string, string>>([
    ["71802001600160", { Price: "0.00", "CGST (Ded-ITC) %": "0.00", "SGST (Ded-ITC) %": "0.00", "IGST (Ded-ITC) %": "0.00" }],
  ]);
  missingLabels = new Set<string>();
  corruptedLabels = new Set<string>();
  writes = 0;

  async readHeader() {
    return this.header;
  }
  async openTab() {}
  async readField(label: string) {
    if (this.corruptedLabels.has(label)) return "SOMETHING ELSE";
    return this.fields.get(label) ?? "";
  }
  async readComment(label: string) {
    return this.comments.get(label) ?? "";
  }
  async writeField(label: string, value: string, _widget: string, options?: { comment?: string }) {
    if (this.missingLabels.has(label)) throw new Error(`label not found: ${label}`);
    this.writes += 1;
    this.fields.set(label, value);
    if (options?.comment !== undefined) this.comments.set(label, options.comment);
  }
  async readConditionRows() {
    return [...this.conditions].map(([itemCode, conditions]) => ({ itemCode, conditions }));
  }
  async writeCondition(itemCode: string, type: string, amount: string) {
    this.writes += 1;
    this.conditions.get(itemCode)![type] = amount;
  }
}

const payload: BidPayload = {
  tenderNumber: "1400014359",
  answers: [
    { key: "supplierGstin", label: GSTIN_LABEL, widget: "text", value: "19ADIPC4887G1Z9", source: "business" },
    { key: "panNumber", label: PAN_LABEL, widget: "text", value: "ADIPC4887G", source: "business" },
    {
      key: "techCommercialValidity",
      label: "Techno commercial offer validity from date of tender opening",
      widget: "radio",
      value: "Yes",
      comment: "20 days",
      source: "profile",
    },
  ],
  items: [
    {
      itemCode: "71802001600160",
      description: "GASKET FOR COOLING PLATE FLANGE",
      quantity: 800,
      rate: 17.75,
      cgstPct: 9,
      sgstPct: 9,
      igstPct: 0,
    },
  ],
  expectedTotal: 14200,
  warnings: [],
};

describe("fillBid", () => {
  let session: FakeSession;
  let upsertFromFill: ReturnType<typeof vi.fn>;
  let auditLog: ReturnType<typeof vi.fn>;
  const input = (overrides: Partial<Parameters<typeof fillBid>[0]> = {}) => ({
    session,
    payload,
    tenderNumber: "1400014359",
    businessId: "biz-1",
    tenderId: "tender-1",
    dryRun: false,
    confirm: async () => true,
    ...overrides,
  });
  const run = (overrides: Partial<Parameters<typeof fillBid>[0]> = {}) =>
    fillBid(input(overrides), {
      portalBids: { upsertFromFill, findByResponseNumber: vi.fn() },
      audit: { log: auditLog },
    });

  beforeEach(() => {
    session = new FakeSession();
    upsertFromFill = vi.fn().mockResolvedValue(undefined);
    auditLog = vi.fn().mockResolvedValue(undefined);
  });

  it("refuses a response that belongs to another RFx before typing anything", async () => {
    session.header.rfxNumber = "1400099999";
    await expect(run()).rejects.toThrow(/RFx 1400099999/);
    expect(session.writes).toBe(0);
  });

  it("writes nothing and stores nothing on a dry run", async () => {
    const result = await run({ dryRun: true });
    expect(session.writes).toBe(0);
    expect(result.filled).toBe(0);
    expect(upsertFromFill).not.toHaveBeenCalled();
  });

  it("aborts without writes when the user declines the warnings", async () => {
    await expect(run({ confirm: async () => false })).rejects.toThrow("Aborted");
    expect(session.writes).toBe(0);
  });

  it("fills every answer and every item condition and reads them back clean", async () => {
    const result = await run();
    expect(result).toMatchObject({ filled: 3 + 4, skipped: [], mismatches: [], responseNumber: "8100095724" });
    expect(session.fields.get(GSTIN_LABEL)).toBe("19ADIPC4887G1Z9");
    expect(session.comments.get("Techno commercial offer validity from date of tender opening")).toBe("20 days");
    expect(session.conditions.get("71802001600160")).toEqual({
      Price: "17.75",
      "CGST (Ded-ITC) %": "9",
      "SGST (Ded-ITC) %": "9",
      "IGST (Ded-ITC) %": "0",
    });
  });

  it("reports a field whose read-back differs", async () => {
    session.corruptedLabels.add(PAN_LABEL);
    const result = await run();
    expect(result.mismatches.some((m) => m.includes(PAN_LABEL))).toBe(true);
  });

  it("skips a label the page does not have and keeps going", async () => {
    session.missingLabels.add(GSTIN_LABEL);
    const result = await run();
    expect(result.skipped).toContain(GSTIN_LABEL);
    expect(session.fields.get(PAN_LABEL)).toBe("ADIPC4887G");
  });

  it("reports a portal item that has no BOQ item, and a BOQ item the portal lacks", async () => {
    session.conditions.set("5550001", { Price: "0.00" });
    session.conditions.delete("71802001600160");
    const result = await run();
    expect(result.skipped).toEqual(
      expect.arrayContaining(["item 71802001600160 is not on the portal", "portal item 5550001 has no BOQ item"]),
    );
  });

  it("flags a Total Value that does not match the BOQ total", async () => {
    session.header.totalValue = "10.00 INR";
    const result = await run();
    expect(result.mismatches.some((m) => m.includes("Total Value"))).toBe(true);
  });

  it("stores the response number and audits the run", async () => {
    await run();
    expect(upsertFromFill).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-1",
        tenderId: "tender-1",
        portalCode: "SAIL_ISP",
        responseNumber: "8100095724",
        totalValue: 14200,
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TENDER_PORTAL_FILL_COMPLETED",
        entityType: "Tender",
        entityId: "tender-1",
      }),
    );
  });
});
