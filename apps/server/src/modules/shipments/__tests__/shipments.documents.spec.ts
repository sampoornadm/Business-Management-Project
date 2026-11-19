import { describe, expect, it, vi } from "vitest";

import {
  type DocumentReaderRepository,
  detectDocumentKind,
  isSailIiscoDocument,
  sameReference,
  ShipmentDocumentReader,
} from "../shipments.documents.js";
import type { ShipmentWithDetails } from "../shipments.repository.js";

const BUSINESS = "business-1";

function shipment(overrides: Partial<ShipmentWithDetails>): ShipmentWithDetails {
  return {
    id: "s1",
    number: 1,
    clientPurchaseOrderId: "cpo-1",
    ewayBillNumber: null,
    dispatchedAt: null,
    grnNumber: null,
    billId: null,
    settledAt: null,
    ...overrides,
  } as ShipmentWithDetails;
}

function setup(shipments: ShipmentWithDetails[], modelReply: unknown, text = "Goods Receipt Note\nPO 4500001234") {
  const repository: DocumentReaderRepository = {
    findProject: async (id) => (id === "project-1" ? { id, tenderId: "tender-1" } : null),
    findManyByProject: async () => shipments,
    findClientPurchaseOrders: async () => [
      { id: "cpo-1", poNumber: "4500001234" },
      { id: "cpo-2", poNumber: "4500009999" },
    ],
    findVendorPurchaseOrders: async () => [{ id: "vpo-1", poNumber: "PO-2026-0007", vendorName: "Vendor A", total: 10000 }],
  };
  const generateJson = vi.fn().mockResolvedValue(modelReply);
  const reader = new ShipmentDocumentReader(repository, generateJson, vi.fn().mockResolvedValue(text));
  return { reader, generateJson };
}

describe("document kind detection", () => {
  it("takes the phrase that appears first, so an invoice quoting its e-way bill stays an invoice", () => {
    expect(detectDocumentKind("TAX INVOICE\nInvoice No 12\nE-Way Bill No 1234")).toBe("VENDOR_INVOICE");
    expect(detectDocumentKind("e-Way Bill\nEWB No: 1234 5678 9012\nDoc: Tax Invoice")).toBe("EWAY_BILL");
    expect(detectDocumentKind("GOODS RECEIPT NOTE\nAgainst invoice 12")).toBe("GRN");
    expect(detectDocumentKind("Quotation")).toBeNull();
  });

  it("spots SAIL IISCO documents and compares references loosely", () => {
    expect(isSailIiscoDocument("Steel Authority of India Limited, IISCO Steel Plant")).toBe(true);
    expect(isSailIiscoDocument("Some other company")).toBe(false);
    expect(sameReference("PO/2026-0007", "po 2026 0007")).toBe(true);
    expect(sameReference("", "")).toBe(false);
  });
});

describe("ShipmentDocumentReader", () => {
  it("matches a GRN to the one dispatched shipment on the PO it quotes", async () => {
    const { reader } = setup(
      [
        shipment({ id: "s1", dispatchedAt: new Date() }),
        shipment({ id: "s2", number: 2, clientPurchaseOrderId: "cpo-2", dispatchedAt: new Date() }),
        shipment({ id: "s3", number: 3 }),
      ],
      { documentNumber: "GRN-77", documentDate: "2026-11-25", poNumber: "4500 001234" },
    );
    const result = await reader.read("project-1", Buffer.from("x"), "application/pdf", undefined, BUSINESS);
    expect(result).toMatchObject({
      kind: "GRN",
      reader: "AI",
      documentNumber: "GRN-77",
      documentDate: "2026-11-25",
      clientPurchaseOrderId: "cpo-1",
      shipmentIds: ["s1"],
    });
  });

  it("warns instead of matching when the e-way bill is already recorded", async () => {
    const { reader } = setup(
      [shipment({ id: "s1", ewayBillNumber: "1234 5678 9012", dispatchedAt: new Date() }), shipment({ id: "s2", number: 2 })],
      { documentNumber: "123456789012", documentDate: "not a date" },
      "e-Way Bill",
    );
    const result = await reader.read("project-1", Buffer.from("x"), "application/pdf", undefined, BUSINESS);
    expect(result.kind).toBe("EWAY_BILL");
    expect(result.documentDate).toBeNull();
    expect(result.shipmentIds).toEqual([]);
    expect(result.warnings.join(" ")).toContain("already recorded on shipment 1");
  });

  it("finds the vendor PO of an invoice and flags a total that differs", async () => {
    const { reader } = setup([], { documentNumber: "INV-9", poNumber: "PO 2026 0007", amount: 11800 }, "Tax Invoice");
    const result = await reader.read("project-1", Buffer.from("x"), "application/pdf", undefined, BUSINESS);
    expect(result.purchaseOrder).toMatchObject({ id: "vpo-1", total: 10000 });
    expect(result.amount).toBe(11800);
    expect(result.warnings.join(" ")).toContain("differs from the PO total");
  });

  it("sends a SAIL IISCO document to the model while no IISCO reader exists, and says so", async () => {
    const { reader, generateJson } = setup([], { documentNumber: "GRN-1" }, "IISCO Steel Plant\nGoods Receipt Note");
    const result = await reader.read("project-1", Buffer.from("x"), "application/pdf", "GRN", BUSINESS);
    expect(generateJson).toHaveBeenCalledOnce();
    expect(result.reader).toBe("AI");
    expect(result.warnings.join(" ")).toContain("No SAIL IISCO GRN reader");
  });

  it("does not call the model when the file has no text", async () => {
    const { reader, generateJson } = setup([], {}, "");
    const result = await reader.read("project-1", Buffer.from("x"), "application/pdf", "GRN", BUSINESS);
    expect(generateJson).not.toHaveBeenCalled();
    expect(result.warnings[0]).toContain("No text could be read");
  });
});
