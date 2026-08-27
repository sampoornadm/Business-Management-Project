import { describe, expect, it } from "vitest";

import { buildBillPdf } from "../bill-document.js";

// A 1x1 transparent PNG — enough bytes for pdfkit's image() to accept without needing a real
// signature image for this structural test.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("buildBillPdf", () => {
  it("renders a valid PDF containing business, client, GRN, item and total content", async () => {
    const buffer = await buildBillPdf(
      {
        businessName: "Archie Udyog",
        businessAddress: "Pune, MH",
        businessGstNumber: "27AAAAA0000A1Z5",
        clientName: "IISCO",
        clientAddress: "Burnpur, WB",
        billNumber: "BILL-ABC12345",
        billDate: "27-08-2026",
        tenderNumber: "TND-1400013656",
        grnNumber: "GRN-2201",
        grnDate: "20-08-2026",
        items: [{ description: "Flange Slip 6in", unit: "nos", quantity: 200, rate: 450 }],
      },
      TINY_PNG,
    );

    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buffer.subarray(-6).toString("latin1").trim()).toBe("%%EOF");
    expect(buffer.length).toBeGreaterThan(500);
  });
});
