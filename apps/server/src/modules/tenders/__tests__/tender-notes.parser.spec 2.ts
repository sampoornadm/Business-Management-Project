import { describe, expect, it } from "vitest";

import { parseTenderNotes } from "../tender-notes.parser.js";

describe("parseTenderNotes", () => {
  it("captures titled notes and a numbered list, stripping letterhead and stopping at the item table", () => {
    const text = [
      "IISCO STEEL PLANT",
      "ISP GST : 19AAACS7062F6Z6",
      "Page 2 / 5",
      "Note:- Anti-bribery Undertaking:",
      "No bribes shall be given or taken.",
      "Note:",
      "1. Accept the terms and conditions.",
      "2. Refer SAIL-P1 before submitting.",
      "RFQ Item Details",
      "1. This is a BOQ row, not a note.",
    ].join("\n");

    const out = parseTenderNotes(text)!;

    expect(out).toContain("## Anti-bribery Undertaking");
    expect(out).toContain("No bribes shall be given or taken.");
    expect(out).toContain("## Notes");
    expect(out).toContain("- Accept the terms and conditions.");
    expect(out).toContain("- Refer SAIL-P1 before submitting.");
    // Letterhead stripped, and nothing after the item-table hard stop leaks in.
    expect(out).not.toContain("IISCO STEEL");
    expect(out).not.toContain("BOQ row");
  });

  it("joins a wrapped continuation onto the previous point", () => {
    const out = parseTenderNotes(["Note:", "1. First part of a point", "that wrapped to a new line."].join("\n"))!;
    expect(out).toContain("- First part of a point that wrapped to a new line.");
  });

  it("returns null when there are no note/ITT sections", () => {
    expect(parseTenderNotes("Just an item table\nSl No Item Code Qty")).toBeNull();
  });
});
