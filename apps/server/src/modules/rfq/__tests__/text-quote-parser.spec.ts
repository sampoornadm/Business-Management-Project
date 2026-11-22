import { describe, expect, it } from "vitest";

import { parseQuoteText, type PasteItem } from "../text-quote-parser.js";

// Anonymised shape of a real vendor reply: Sl No, description, unit, qty@rate/-, tab-separated.
const SIZES = [
  "12X1", "12X1.5", " 16X1", "16X1.5", " 20X1.5", " 20X2.5", " 20X3", "25X1.5", "25X2", " 25X2.5", " 25X3",
  "33X1.5", "33X2", " 33X2.5", "33X3", " 43X2", "43X2.5", "7.65X1.78", "10.5X3", "12.9X1.25", "12.9X1.75",
  "19X2.5", "33.3X3.6", "85X3.75", "16X1.75",
];
const RATES = [10, 10, 12, 12, 15, 15, 15, 20, 20, 20, 20, 25, 25, 25, 25, 30, 30, 10, 10, 10, 10, 15, 20, 60, 12];
const QTYS = SIZES.map((_, i) => (i < 17 ? 150 : 100));

const ITEMS: PasteItem[] = SIZES.map((size, i) => ({
  description: `"O" RING : ID X THICKNESS : (${size.trim()}) MM`,
  quantity: QTYS[i]!,
  unit: "EA",
}));

const vendorLine = (i: number, withSerial = true) =>
  `${withSerial ? `${i + 1}\t` : ""}"O" RING : ID X THICKNESS : (${SIZES[i]})MM\tEA\t${QTYS[i]}@${RATES[i]}/-`;

const SAMPLE = SIZES.map((_, i) => vendorLine(i)).join("\n");

const rateByItem = (text: string, items = ITEMS) => {
  const { matches } = parseQuoteText(text, items);
  return new Map(matches.map((m) => [m.itemIndex, m]));
};

describe("parseQuoteText", () => {
  it("reads qty@rate lines by serial", () => {
    const result = parseQuoteText(SAMPLE, ITEMS);
    expect(result.unread).toEqual([]);
    expect(result.matches).toHaveLength(25);
    const sorted = [...result.matches].sort((a, b) => a.itemIndex - b.itemIndex);
    expect(sorted.map((m) => m.rate)).toEqual(RATES);
    expect(sorted.map((m) => m.vendorQuantity)).toEqual(QTYS);
    expect(sorted.every((m) => m.source === "serial" && m.warnings.length === 0)).toBe(true);
  });

  it("matches by description when serials are missing", () => {
    const order = [24, 3, 0, 17, 11, 8, 1, 22, 5, 14, 19, 2, 9, 23, 6, 15, 20, 4, 12, 18, 7, 16, 10, 21, 13];
    const byItem = rateByItem(order.map((i) => vendorLine(i, false)).join("\n"));
    expect(byItem.size).toBe(25);
    for (let i = 0; i < 25; i += 1) {
      expect(byItem.get(i)?.rate).toBe(RATES[i]);
      expect(byItem.get(i)?.source).toBe("description");
    }
  });

  it("prefers description when serial points elsewhere", () => {
    const match = rateByItem(`3 "O" RING (12X1.5) MM EA 150@10/-`).get(1);
    expect(match?.rate).toBe(10);
    expect(match?.source).toBe("description");
    expect(match?.warnings).toContain("Serial 3 points at a different item");
  });

  it("keeps the serial item but warns when the description matches nothing", () => {
    const match = rateByItem(`3 "O" RING (99X9) MM EA 150@12/-`).get(2);
    expect(match?.rate).toBe(12);
    expect(match?.source).toBe("serial");
    expect(match?.warnings).toContain("Description doesn't match item 3");
  });

  it("accepts bare serial lines", () => {
    const match = rateByItem("3 - 450").get(2);
    expect(match).toMatchObject({ rate: 450, regretted: false, source: "serial" });
  });

  it("reads regrets", () => {
    const byItem = rateByItem("4 regret\n5 - not available\n6 NA");
    for (const i of [3, 4, 5]) expect(byItem.get(i)).toMatchObject({ regretted: true, rate: null });
  });

  it("reads rupee and per-unit forms", () => {
    const byItem = rateByItem("1 - Rs 1,250/-\n2 @ 450 per mtr\n3 ₹ 99.50");
    expect(byItem.get(0)?.rate).toBe(1250);
    expect(byItem.get(1)?.rate).toBe(450);
    expect(byItem.get(2)?.rate).toBe(99.5);
  });

  it("ignores chatter", () => {
    const result = parseQuoteText("Good morning sir\n\n1 - 10\nRegards", ITEMS);
    expect(result.matches).toHaveLength(1);
    expect(result.unread).toEqual([]);
  });

  it("flags duplicate claims", () => {
    const result = parseQuoteText("1 - 10\n1 - 11", ITEMS);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.rate).toBe(10);
    expect(result.unread).toEqual([
      { lineIndex: 1, text: "1 - 11", reason: "Item 1 already matched by line 1" },
    ]);
  });

  it("removes only one occurrence of rate/qty from leftovers", () => {
    const items: PasteItem[] = [{ description: "PLATE (10X150)", quantity: 150, unit: "NOS" }];
    const match = rateByItem("1 PLATE (10X150) NOS 150@10/-", items).get(0);
    expect(match).toMatchObject({ rate: 10, source: "serial", warnings: [] });
  });

  it("handles CRLF, nbsp and chat-export headers", () => {
    const match = rateByItem(`[20/11, 10:42 am] Supplier: 1\u00a0"O" RING (12X1) MM EA 150@10/-\r\n`).get(0);
    expect(match).toMatchObject({ rate: 10, source: "serial", warnings: [] });
  });

  it("detects GST wording", () => {
    expect(parseQuoteText("1 - 10\nrates + GST extra", ITEMS).gstMentioned).toBe(true);
    expect(parseQuoteText(SAMPLE, ITEMS).gstMentioned).toBe(false);
  });

  it("leaves prose with numbers unread", () => {
    const result = parseQuoteText("all 33mm rings same as last time", ITEMS);
    expect(result.matches).toEqual([]);
    expect(result.unread).toHaveLength(1);
    expect(result.unread[0]?.lineIndex).toBe(0);
  });

  it("warns when the vendor's quantity differs", () => {
    const match = rateByItem(`1\t"O" RING (12X1) MM\tEA\t100@10/-`).get(0);
    expect(match?.warnings).toContain("Vendor quoted for 100, RFQ asks 150");
  });
});
