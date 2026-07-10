import { describe, expect, it } from "vitest";

import { SCOPED_MODELS, assertBusinessScoped } from "../scoped-client.js";

describe("assertBusinessScoped", () => {
  it("throws when a scoped model's where clause has no businessId", () => {
    expect(() => assertBusinessScoped("Tender", { status: "DRAFT" })).toThrow(/businessId/);
  });

  it("passes when businessId is present at the top level", () => {
    expect(() => assertBusinessScoped("Tender", { businessId: "b1", status: "DRAFT" })).not.toThrow();
  });

  it("passes when businessId is present inside an AND clause", () => {
    expect(() =>
      assertBusinessScoped("Tender", { AND: [{ businessId: "b1" }, { status: "DRAFT" }] }),
    ).not.toThrow();
  });

  it("ignores non-scoped models entirely", () => {
    expect(() => assertBusinessScoped("Vendor", { name: "Acme" })).not.toThrow();
  });

  it("lists exactly the 11 scoped model names", () => {
    expect(SCOPED_MODELS).toEqual(
      new Set([
        "Tender", "Project", "Boq", "Rfq", "PurchaseOrder", "GoodsReceipt",
        "BankAccount", "Invoice", "Expense", "Payment", "HistoricalRate",
      ]),
    );
  });
});
