import { describe, expect, it } from "vitest";

import { buildSupplyLines, shipmentQuantityProblem, shipmentStage } from "../shipments.logic.js";

describe("shipmentStage", () => {
  const base = { dispatchedAt: null, grnNumber: null, billId: null, settledAt: null };
  it("moves through the stages as each step is recorded", () => {
    expect(shipmentStage(base)).toBe("PREPARING");
    expect(shipmentStage({ ...base, dispatchedAt: new Date() })).toBe("DISPATCHED");
    expect(shipmentStage({ ...base, dispatchedAt: new Date(), grnNumber: "G1" })).toBe("GRN_RECEIVED");
    expect(shipmentStage({ ...base, dispatchedAt: new Date(), grnNumber: "G1", billId: "b" })).toBe("BILLED");
    expect(shipmentStage({ dispatchedAt: new Date(), grnNumber: "G1", billId: "b", settledAt: new Date() })).toBe("PAID");
  });
});

describe("buildSupplyLines", () => {
  const vendor = { purchaseOrderId: "vpo", poNumber: "VPO-1", vendorName: "Vendor A", status: "PARTIALLY_RECEIVED" as const };

  it("adds split client POs for the same BOQ line and joins vendor POs on it", () => {
    const lines = buildSupplyLines(
      [
        { id: "c1", boqItemId: "boq-1", itemCode: null, description: "Cable", unit: "Mtr", quantity: 60 },
        { id: "c2", boqItemId: "boq-1", itemCode: null, description: "Cable", unit: "Mtr", quantity: 40 },
        { id: "c3", boqItemId: null, description: "Extra", itemCode: null, unit: "Nos", quantity: 2 },
      ],
      [
        { ...vendor, boqItemId: "boq-1", quantity: 100, receivedQuantity: 70 },
        { ...vendor, purchaseOrderId: "cancelled", status: "CANCELLED", boqItemId: "boq-1", quantity: 50, receivedQuantity: 0 },
      ],
      [
        { clientPoItemId: "c1", quantity: 30, dispatched: true, accepted: true },
        { clientPoItemId: "c2", quantity: 20, dispatched: true, accepted: false },
        { clientPoItemId: "c1", quantity: 10, dispatched: false, accepted: false },
      ],
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ ordered: 100, procured: 100, received: 70, dispatched: 50, accepted: 30 });
    expect(lines[0]!.vendorPurchaseOrders).toHaveLength(2);
    expect(lines[1]).toMatchObject({ key: "line:c3", ordered: 2, procured: 0, vendorPurchaseOrders: [] });
  });
});

describe("shipmentQuantityProblem", () => {
  const ordered = new Map([["c1", { description: "Cable", quantity: 100 }]]);
  it("allows up to what is left to ship and rejects more", () => {
    expect(shipmentQuantityProblem([{ clientPoItemId: "c1", quantity: 40 }], ordered, new Map([["c1", 60]]))).toBeNull();
    expect(shipmentQuantityProblem([{ clientPoItemId: "c1", quantity: 41 }], ordered, new Map([["c1", 60]]))).toContain(
      "only 40 left",
    );
  });
  it("rejects empty, foreign and duplicated lines", () => {
    expect(shipmentQuantityProblem([], ordered, new Map())).toContain("at least one");
    expect(shipmentQuantityProblem([{ clientPoItemId: "x", quantity: 1 }], ordered, new Map())).toContain("not on this client PO");
    expect(
      shipmentQuantityProblem(
        [
          { clientPoItemId: "c1", quantity: 1 },
          { clientPoItemId: "c1", quantity: 1 },
        ],
        ordered,
        new Map(),
      ),
    ).toContain("twice");
  });
});
