import { describe, expect, it } from "vitest";

import { buildRfqText } from "../rfq-document.js";

describe("buildRfqText", () => {
  it("builds a plain-text RFQ with an itemized list and a signature", () => {
    const text = buildRfqText({
      items: [
        { description: "OPC Cement", unit: "bag", quantity: 500 },
        { description: "TMT Steel Bars", unit: "kg", quantity: 1200 },
      ],
      vendorContactName: "Raj Kumar",
      tenderNumber: "TND-0001",
      senderName: "Priya PurchaseManager",
      senderEmail: "priya@bmp.local",
    });

    expect(text).toContain("Dear Raj Kumar,");
    expect(text).toContain("against tender TND-0001");
    expect(text).toContain("1. OPC Cement — Qty: 500 bag");
    expect(text).toContain("2. TMT Steel Bars — Qty: 1200 kg");
    expect(text).toContain("Priya PurchaseManager");
    expect(text).toContain("priya@bmp.local");
  });

  it("omits the tender reference when no tender number is given", () => {
    const text = buildRfqText({
      items: [{ description: "Item", unit: null, quantity: 1 }],
      vendorContactName: "Vendor Contact",
      senderName: "Sender",
      senderEmail: "sender@bmp.local",
    });

    expect(text).not.toContain("against tender");
    expect(text).toContain("1. Item — Qty: 1");
  });

  it("omits the unit when the item has none", () => {
    const text = buildRfqText({
      items: [{ description: "Item", unit: null, quantity: 5 }],
      vendorContactName: "Vendor Contact",
      senderName: "Sender",
      senderEmail: "sender@bmp.local",
    });

    expect(text).toContain("1. Item — Qty: 5\n");
  });
});
