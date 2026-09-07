import PDFDocument from "pdfkit";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";

import { buildRfrDocx, buildRfrPdf, buildRfqText, toRfrDocumentData } from "../rfq-document.js";

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

describe("toRfrDocumentData", () => {
  it("shapes business, RFQ and item data into one document payload", () => {
    const data = toRfrDocumentData(
      {
        title: "Cement Supply RFQ",
        instructions: "Deliver to site within 15 days",
        dueDate: new Date(2026, 8, 1),
        items: [
          { id: "item-1", description: "OPC Cement", unit: "bag", quantity: 500, instructions: "ISI marked only" },
          { id: "item-2", description: "TMT Bars", unit: "kg", quantity: 1200, instructions: null },
        ],
      },
      { name: "Archie Udyog", address: "Pune, MH", gstNumber: "27AAAAA0000A1Z5" },
      "TND-0001",
      ["Inspection required before dispatch"],
    );

    expect(data).toEqual({
      businessName: "Archie Udyog",
      businessAddress: "Pune, MH",
      businessGstNumber: "27AAAAA0000A1Z5",
      rfqTitle: "Cement Supply RFQ",
      tenderNumber: "TND-0001",
      dueDate: "01-09-2026",
      instructions: "Deliver to site within 15 days",
      pinnedNotes: ["Inspection required before dispatch"],
      items: [
        {
          rfqItemId: "item-1",
          description: "OPC Cement",
          unit: "bag",
          quantity: 500,
          instructions: "ISI marked only",
        },
        { rfqItemId: "item-2", description: "TMT Bars", unit: "kg", quantity: 1200, instructions: null },
      ],
    });
  });

  it("carries nulls through when there is no tender, due date or instructions, and an empty pinnedNotes", () => {
    const data = toRfrDocumentData(
      { title: "Standalone RFQ", instructions: null, dueDate: null, items: [] },
      { name: "Archie Udyog", address: null, gstNumber: null },
      null,
      [],
    );

    expect(data.tenderNumber).toBeNull();
    expect(data.dueDate).toBeNull();
    expect(data.instructions).toBeNull();
    expect(data.pinnedNotes).toEqual([]);
  });
});

describe("buildRfrPdf", () => {
  it("renders a valid PDF containing the business, RFQ, and item content", async () => {
    const buffer = await buildRfrPdf({
      businessName: "Archie Udyog",
      businessAddress: "Pune, MH",
      businessGstNumber: "27AAAAA0000A1Z5",
      rfqTitle: "Cement Supply RFQ",
      tenderNumber: "TND-0001",
      dueDate: "01-09-2026",
      instructions: "Deliver to site within 15 days",
      pinnedNotes: [],
      items: [
        {
          rfqItemId: "item-1",
          description: "OPC Cement",
          unit: "bag",
          quantity: 500,
          instructions: "ISI marked only",
        },
      ],
    });

    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buffer.subarray(-6).toString("latin1").trim()).toBe("%%EOF");
    // A doc with a header block + a 9-column table row should run well past a few hundred
    // bytes — this is a floor against a truncated/empty stream, not a content check.
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("computes a row height taller than the old fixed 18pt for a realistic long description", () => {
    // Real item descriptions run 140-180 chars (see quote-sheet.ts's top-of-file comment). At
    // that length, in the 130pt-wide Description column at 8pt font, the cell wraps to 3+
    // lines — proving the old fixed-18pt advance would have overlapped the next row(s), and
    // that the height-based fix in drawRow is exercising a real, not hypothetical, case.
    const longDescription =
      "Supply and delivery of XLPE insulated armoured cable, 4 core x 16 sq mm, as per IS 7098 " +
      "Part 2, including all taxes, duties, transportation to site, and unloading at designated " +
      "store location within the project premises";
    expect(longDescription.length).toBeGreaterThanOrEqual(170);

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    doc.font("Helvetica").fontSize(8);
    const height = doc.heightOfString(longDescription, { width: 130 });

    expect(height).toBeGreaterThan(30);
  });

  it("still returns a valid PDF buffer for a mix of long and short descriptions", async () => {
    const buffer = await buildRfrPdf({
      businessName: "Archie Udyog",
      businessAddress: "Pune, MH",
      businessGstNumber: "27AAAAA0000A1Z5",
      rfqTitle: "Cement Supply RFQ",
      tenderNumber: "TND-0001",
      dueDate: "01-09-2026",
      instructions: "Deliver to site within 15 days",
      pinnedNotes: [],
      items: [
        {
          rfqItemId: "item-1",
          description:
            "Supply and delivery of XLPE insulated armoured cable, 4 core x 16 sq mm, as per IS 7098 " +
            "Part 2, including all taxes, duties, transportation to site, and unloading at designated " +
            "store location within the project premises",
          unit: "m",
          quantity: 500,
          instructions: "ISI marked only",
        },
        { rfqItemId: "item-2", description: "OPC Cement", unit: "bag", quantity: 200, instructions: null },
        { rfqItemId: "item-3", description: "TMT Bars", unit: "kg", quantity: 1200, instructions: null },
      ],
    });

    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("still returns a valid PDF when pinnedNotes is non-empty", async () => {
    const buffer = await buildRfrPdf({
      businessName: "Archie Udyog",
      businessAddress: "Pune, MH",
      businessGstNumber: "27AAAAA0000A1Z5",
      rfqTitle: "Cement Supply RFQ",
      tenderNumber: "TND-0001",
      dueDate: "01-09-2026",
      instructions: "Deliver to site within 15 days",
      pinnedNotes: ["Inspection required before dispatch", "Delivery within 30 days of PO"],
      items: [
        { rfqItemId: "item-1", description: "OPC Cement", unit: "bag", quantity: 500, instructions: null },
      ],
    });

    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(500);
  });
});

describe("buildRfrDocx", () => {
  it("fills the bundled template with business, RFQ and item data", async () => {
    const buffer = await buildRfrDocx({
      businessName: "Archie Udyog",
      businessAddress: "Pune, MH",
      businessGstNumber: "27AAAAA0000A1Z5",
      rfqTitle: "Cement Supply RFQ",
      tenderNumber: "TND-0001",
      dueDate: "01-09-2026",
      instructions: "Deliver to site within 15 days",
      pinnedNotes: [],
      items: [
        {
          rfqItemId: "item-1",
          description: "OPC Cement",
          unit: "bag",
          quantity: 500,
          instructions: "ISI marked only",
        },
        { rfqItemId: "item-2", description: "TMT Bars", unit: "kg", quantity: 1200, instructions: null },
      ],
    });

    const zip = new PizZip(buffer);
    const documentXml = zip.file("word/document.xml")!.asText();

    expect(documentXml).toContain("Archie Udyog");
    expect(documentXml).toContain("Cement Supply RFQ");
    expect(documentXml).toContain("TND-0001");
    expect(documentXml).toContain("Deliver to site within 15 days");
    expect(documentXml).toContain("OPC Cement");
    expect(documentXml).toContain("ISI marked only");
    expect(documentXml).toContain("TMT Bars");
    expect(documentXml).not.toContain("{{#items}}");
    expect(documentXml).not.toContain("{{/items}}");
    // Two items in the loop must produce two separate table rows, not one merged row.
    expect(documentXml.split("OPC Cement")).toHaveLength(2);
    expect(documentXml.split("TMT Bars")).toHaveLength(2);
  });

  it("omits dangling labels (GSTIN/Tender Ref/Instructions) when their data is null", async () => {
    const buffer = await buildRfrDocx({
      businessName: "Archie Udyog",
      businessAddress: "Pune, MH",
      businessGstNumber: null,
      rfqTitle: "Cement Supply RFQ",
      tenderNumber: null,
      dueDate: null,
      instructions: null,
      pinnedNotes: [],
      items: [{ rfqItemId: "item-1", description: "OPC Cement", unit: "bag", quantity: 500, instructions: null }],
    });

    const zip = new PizZip(buffer);
    const documentXml = zip.file("word/document.xml")!.asText();

    expect(documentXml).not.toContain("GSTIN:");
    expect(documentXml).not.toContain("Tender Ref:");
    expect(documentXml).not.toContain("Instructions:");
    // The address itself should still render — only the missing fields' labels are gone.
    expect(documentXml).toContain("Pune, MH");
  });

  it("renders an Important Notes section when pinnedNotes is non-empty", async () => {
    const buffer = await buildRfrDocx({
      businessName: "Archie Udyog",
      businessAddress: "Pune, MH",
      businessGstNumber: "27AAAAA0000A1Z5",
      rfqTitle: "Cement Supply RFQ",
      tenderNumber: "TND-0001",
      dueDate: "01-09-2026",
      instructions: "Deliver to site within 15 days",
      pinnedNotes: ["Inspection required before dispatch", "Delivery within 30 days of PO"],
      items: [
        { rfqItemId: "item-1", description: "OPC Cement", unit: "bag", quantity: 500, instructions: null },
      ],
    });

    const zip = new PizZip(buffer);
    const documentXml = zip.file("word/document.xml")!.asText();

    expect(documentXml).toContain("Important Notes");
    // Each note must render as its own bullet-prefixed run, not just appear somewhere in the XML —
    // this is what actually fails on the old inline-loop template, where the two notes are glued
    // together into a single run with no separator.
    expect(documentXml).toContain("• Inspection required before dispatch");
    expect(documentXml).toContain("• Delivery within 30 days of PO");
    expect(documentXml).not.toContain("dispatchDelivery");
    expect(documentXml).not.toContain("{{#pinnedNotes}}");
    expect(documentXml).not.toContain("{{/pinnedNotes}}");
    expect(documentXml).not.toContain("{{#hasPinnedNotes}}");
    expect(documentXml).not.toContain("{{/hasPinnedNotes}}");
  });

  it("omits the Important Notes heading entirely when pinnedNotes is empty", async () => {
    const buffer = await buildRfrDocx({
      businessName: "Archie Udyog",
      businessAddress: "Pune, MH",
      businessGstNumber: "27AAAAA0000A1Z5",
      rfqTitle: "Cement Supply RFQ",
      tenderNumber: "TND-0001",
      dueDate: "01-09-2026",
      instructions: "Deliver to site within 15 days",
      pinnedNotes: [],
      items: [
        { rfqItemId: "item-1", description: "OPC Cement", unit: "bag", quantity: 500, instructions: null },
      ],
    });

    const zip = new PizZip(buffer);
    const documentXml = zip.file("word/document.xml")!.asText();

    expect(documentXml).not.toContain("Important Notes");
  });
});
