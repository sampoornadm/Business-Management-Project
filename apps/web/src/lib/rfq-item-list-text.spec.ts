import { describe, expect, it } from "vitest";

import { buildRfqItemListText } from "./rfq-item-list-text";

describe("buildRfqItemListText", () => {
  it("lists items, then requirements, then the due date", () => {
    const text = buildRfqItemListText(
      [
        { description: "TMT Steel", quantity: 1200, unit: "MT" },
        { description: "Cement", quantity: 50, unit: null },
      ],
      ["Delivery within 30 days", "GST extra"],
      "2026-12-01T00:00:00.000Z",
    );

    expect(text).toBe(
      [
        "Sl No. | Item Desc | Qty | UoM",
        "1 | TMT Steel | 1200 | MT",
        "2 | Cement | 50 | -",
        "",
        "Requirements:",
        "- Delivery within 30 days",
        "- GST extra",
        "",
        "Please send your rates by 01/12/2026.",
      ].join("\n"),
    );
  });

  it("omits requirements and due date when there are none", () => {
    const text = buildRfqItemListText([{ description: "Bolt", quantity: 4, unit: "Nos" }], [], null);

    expect(text).toBe("Sl No. | Item Desc | Qty | UoM\n1 | Bolt | 4 | Nos");
  });
});
