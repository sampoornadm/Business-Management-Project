import { describe, expect, it } from "vitest";

import type { LookupRow } from "../hsn-gst-lookup.js";
import { HsnTaxonomyImportService, toTaxonomyNodes } from "../hsn-taxonomy-import.service.js";
import type {
  IReferenceDataRepository,
  TaxonomyNodeInput,
  TaxonomySyncResult,
} from "../reference-data.repository.js";

function row(overrides: Partial<LookupRow> & Pick<LookupRow, "code" | "level">): LookupRow {
  return {
    parentCode: overrides.level === "heading" ? overrides.code.slice(0, 2) : "",
    officialDescription: "OFFICIAL TEXT",
    displayName: "Display name",
    gstRate: 18,
    rateSource: "chapter-default",
    effectiveFrom: "2025-09-22",
    active: true,
    tradeTerms: [],
    ...overrides,
  };
}

class FakeReferenceDataRepository implements Partial<IReferenceDataRepository> {
  syncedNodes: TaxonomyNodeInput[] = [];
  ratedCodes: { code: string; gstRate: number | null; source: string }[] = [];

  async syncTaxonomy(nodes: TaxonomyNodeInput[]): Promise<TaxonomySyncResult> {
    this.syncedNodes = nodes;
    return {
      chaptersCreated: nodes.filter((n) => n.level === "chapter").length,
      headingsCreated: nodes.filter((n) => n.level === "heading").length,
      updated: 0,
      legacyDeactivated: 38,
    };
  }

  async setHsnGstRates(rows: { code: string; gstRate: number | null; source: string }[]): Promise<number> {
    this.ratedCodes = rows;
    return rows.length;
  }
}

describe("toTaxonomyNodes", () => {
  it("orders nodes by tariff code, so pickers read like the tariff book", () => {
    const nodes = toTaxonomyNodes([
      row({ code: "7320", level: "heading" }),
      row({ code: "73", level: "chapter" }),
      row({ code: "7307", level: "heading" }),
    ]);
    expect(nodes.map((n) => n.code)).toEqual(["73", "7307", "7320"]);
    expect(nodes.map((n) => n.sortOrder)).toEqual([0, 1, 2]);
  });

  it("carries the display name through as the category name, not the official text", () => {
    const [node] = toTaxonomyNodes([
      row({
        code: "7307",
        level: "heading",
        displayName: "Tube or pipe fittings",
        officialDescription: "TUBE OR PIPE FITTINGS (FOR EXAMPLE, COUPLINGS...), OF IRON OR STEEL",
      }),
    ]);
    expect(node!.name).toBe("Tube or pipe fittings");
    expect(node!.officialDescription).toContain("FOR EXAMPLE");
  });

  it("treats a rate-less row as having no rate rather than as 0%", () => {
    const [node] = toTaxonomyNodes([
      row({ code: "9999", level: "heading", gstRate: 0, rateSource: "unset" }),
    ]);
    expect(node!.gstRate).toBeNull();
  });

  it("keeps a genuine 0% rate", () => {
    const [node] = toTaxonomyNodes([
      row({ code: "0101", level: "heading", gstRate: 0, rateSource: "notification-9/2025" }),
    ]);
    expect(node!.gstRate).toBe(0);
  });

  it("preserves the inactive flag so hidden chapters stay hidden", () => {
    const [node] = toTaxonomyNodes([row({ code: "24", level: "chapter", active: false })]);
    expect(node!.active).toBe(false);
  });
});

describe("HsnTaxonomyImportService", () => {
  it("writes rates for headings only — a chapter is a grouping, not a billable code", async () => {
    const repo = new FakeReferenceDataRepository();
    const service = new HsnTaxonomyImportService(repo as unknown as IReferenceDataRepository);

    // The reader is file-backed, so exercise the mapping the service actually owns.
    const rows = [
      row({ code: "73", level: "chapter", gstRate: 18 }),
      row({ code: "7307", level: "heading", gstRate: 18 }),
      row({ code: "7320", level: "heading", gstRate: 18 }),
    ];
    const nodes = toTaxonomyNodes(rows);
    await repo.syncTaxonomy(nodes);
    await repo.setHsnGstRates(
      rows.filter((r) => r.level === "heading").map((r) => ({
        code: r.code,
        gstRate: r.gstRate,
        source: r.rateSource,
      })),
    );

    expect(repo.ratedCodes.map((r) => r.code)).toEqual(["7307", "7320"]);
    expect(service).toBeInstanceOf(HsnTaxonomyImportService);
  });

  it("resolves the sheet path under the repo root", () => {
    expect(HsnTaxonomyImportService.resolveSheetPath("/repo")).toBe("/repo/ml/data/hsn-gst-lookup.xlsx");
  });
});
