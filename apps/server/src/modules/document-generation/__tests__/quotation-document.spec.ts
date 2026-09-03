import { describe, expect, it, vi } from "vitest";

import type { BoqItemDto } from "@bmp/types";

function item(overrides: Partial<BoqItemDto> = {}): BoqItemDto {
  return {
    id: "item-1",
    parentId: null,
    itemCode: "IT-1",
    description: "Widget",
    category: null,
    unit: "Nos",
    quantity: 10,
    rate: 100,
    amount: 1000,
    gstRate: 18,
    remarks: null,
    sortOrder: 0,
    rateBreakdown: null,
    normalizedName: null,
    aiCategory: null,
    aiSubcategory: null,
    aiConfidence: null,
    suggestedRate: null,
    aiSource: null,
    aiEnrichedAt: null,
    rateSourceConfirmed: false,
    children: [],
    ...overrides,
  };
}

describe("buildQuotationRows", () => {
  it("flattens a tree depth-first, indenting nested items", async () => {
    const { buildQuotationRows } = await import("../quotation-document.js");
    const tree = [
      item({ id: "a", description: "Group A", children: [item({ id: "a1", description: "Child 1" })] }),
      item({ id: "b", description: "Group B" }),
    ];

    const rows = buildQuotationRows(tree);

    expect(rows.map((r) => r.description)).toEqual(["Group A", "  Child 1", "Group B"]);
  });

  it("renders null quantity/rate/amount as blank strings", async () => {
    const { buildQuotationRows } = await import("../quotation-document.js");
    const rows = buildQuotationRows([item({ quantity: null, rate: null, amount: null })]);

    expect(rows[0]).toMatchObject({ quantity: "", rate: "", amount: "" });
  });
});

describe("buildQuotationCsv", () => {
  it("produces a header row, one row per item, and a total row", async () => {
    const { buildQuotationCsv, buildQuotationRows } = await import("../quotation-document.js");
    const rows = buildQuotationRows([item()]);

    const csv = buildQuotationCsv(rows, 1000).toString("utf-8");
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe("Item Code,Description,Unit,Quantity,Rate,Amount");
    // amount formats as "1,000" (en-IN grouping) — its own comma makes escapeCsvField quote the
    // whole field, same as it would quote any description containing a comma.
    expect(lines[1]).toBe('IT-1,Widget,Nos,10,100,"1,000"');
    expect(lines[2]).toBe(',,,,Total,"1,000"');
  });

  it("quotes a description containing a comma", async () => {
    const { buildQuotationCsv, buildQuotationRows } = await import("../quotation-document.js");
    const rows = buildQuotationRows([item({ description: "Widget, large" })]);

    const csv = buildQuotationCsv(rows, 1000).toString("utf-8");

    expect(csv).toContain('"Widget, large"');
  });
});

describe("buildQuotationPdf", () => {
  it("produces a non-empty PDF buffer", async () => {
    const { buildQuotationPdf, buildQuotationRows } = await import("../quotation-document.js");
    const rows = buildQuotationRows([item()]);

    const buffer = await buildQuotationPdf(rows, 1000, {
      businessName: "Archie Udyog",
      tenderNumber: "TEN-001",
      tenderTitle: "Road Widening",
      clientName: "Acme Corp",
    });

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});

describe("generateQuotation", () => {
  it("builds a csv from the tender's current BOQ", async () => {
    const fakeTendersRepository = {
      findForDocumentGeneration: vi.fn().mockResolvedValue({
        tenderNumber: "TEN-001",
        title: "Road Widening",
        business: { code: "ARCHIE", name: "Archie Udyog", address: null, gstNumber: null, panNumber: null },
        client: { name: "Acme Corp", address: null },
      }),
    };
    const fakeBoqRepository = {
      findCurrentBoq: vi.fn().mockResolvedValue({ id: "boq-1" }),
      findItemsByBoqId: vi.fn().mockResolvedValue([item()]),
    };

    const { generateQuotation } = await import("../quotation-document.js");
    const result = await generateQuotation(
      fakeTendersRepository,
      fakeBoqRepository,
      "tender-1",
      "business-1",
      "csv",
    );

    expect(result.mimeType).toBe("text/csv");
    expect(result.filename).toMatch(/^Quotation-TEN-001-\d{2}-\d{2}-\d{4}\.csv$/);
    expect(result.buffer.toString("utf-8")).toContain("Widget");
    expect(fakeBoqRepository.findCurrentBoq).toHaveBeenCalledWith("tender-1", "business-1");
  });

  it("throws NotFoundError when the tender doesn't exist", async () => {
    const fakeTendersRepository = { findForDocumentGeneration: vi.fn().mockResolvedValue(null) };
    const fakeBoqRepository = { findCurrentBoq: vi.fn(), findItemsByBoqId: vi.fn() };

    const { generateQuotation } = await import("../quotation-document.js");
    await expect(
      generateQuotation(fakeTendersRepository, fakeBoqRepository, "missing", "business-1", "csv"),
    ).rejects.toThrow("Tender not found");
  });

  it("throws NotFoundError when the tender has no BOQ", async () => {
    const fakeTendersRepository = {
      findForDocumentGeneration: vi.fn().mockResolvedValue({
        tenderNumber: "TEN-001",
        title: "Road Widening",
        business: { code: "ARCHIE", name: "Archie Udyog", address: null, gstNumber: null, panNumber: null },
        client: { name: "Acme Corp", address: null },
      }),
    };
    const fakeBoqRepository = { findCurrentBoq: vi.fn().mockResolvedValue(null), findItemsByBoqId: vi.fn() };

    const { generateQuotation } = await import("../quotation-document.js");
    await expect(
      generateQuotation(fakeTendersRepository, fakeBoqRepository, "tender-1", "business-1", "csv"),
    ).rejects.toThrow(/no boq/i);
  });
});
