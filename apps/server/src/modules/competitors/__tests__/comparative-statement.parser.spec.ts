import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseComparativeMatrix, StatementParseError } from "../comparative-statement.parser.js";

const matrix = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures", "comparative-1400000013.matrix.json"), "utf8"),
) as string[][];

const clone = (m: string[][]) => m.map((row) => [...row]);
const rowOf = (m: string[][], label: string) => {
  const index = m.findIndex((row) => row[0] === label);
  if (index < 0) throw new Error(`fixture has no row "${label}"`);
  return index;
};
function setCell(m: string[][], label: string, column: number, value: string): string[][] {
  const copy = clone(m);
  copy[rowOf(copy, label)]![column] = value;
  return copy;
}
const blankCell = (m: string[][], label: string, column: number) => setCell(m, label, column, "");

/** The fixture with its item block repeated as item 002, basic rates 10..50. */
function withSecondItem(m: string[][]): string[][] {
  const start = rowOf(m, "Sl No");
  const end = rowOf(m, "Landed Cost Per Unit ( INR )");
  const block = clone(m.slice(start, end + 1));
  for (const row of block) {
    if (row[0] === "Sl No") row.fill("002", 1);
    if (row[0] === "Item Code") row.fill("20110601001999", 1);
    if (row[0] === "Basic Price Per Unit") [10, 20, 30, 40, 50].forEach((rate, i) => (row[i + 1] = `${rate}.00`));
  }
  return [...clone(m.slice(0, end + 1)), ...block, ...clone(m.slice(end + 1))];
}

describe("parseComparativeMatrix", () => {
  it("reads the real 1400000013 statement", () => {
    const s = parseComparativeMatrix(matrix);
    expect(s.rfxNumber).toBe("1400000013");
    expect(s.description).toBe("MJ/S02/2026/1007_COIL SPRING");
    expect(s.basisOfEvaluation).toBe("Overall");
    expect(s.bidEnd?.toISOString()).toBe("2026-10-23T09:30:00.000Z"); // 23.10.2026 15:00:00 IST
    expect(s.bids.map((b) => [b.vendorCode, b.vendorName, b.quotationRef, b.total])).toEqual([
      ["1000000001", "ALPHA SPRING WORKS", "8100000001", 891000],
      ["1000000002", "BETA ENGINEERING CORPORATION", "8100000002", 528000],
      ["1000000003", "GAMMA ENGINEERING WORKS", "8100000003", 610500],
      ["1000000004", "DELTA ENTERPRISES", "8100000004", 561000],
      ["1000000005", "EPSILON INDUSTRIES", "8100000005", 940500],
    ]);
    expect(s.bids.map((b) => b.items[0]!.basicRate)).toEqual([270, 160, 185, 170, 285]);
    expect(s.bids.map((b) => b.items[0]!.landedRate)).toEqual([318.6, 188.80, 218.30, 200.60, 336.3]);
    expect(s.bids[1]!.items[0]).toMatchObject({
      slNo: "001",
      itemCode: "20110601001260",
      description: "COIL SPRING,PSL-1397,MK-20",
      unit: "EA",
      rfqQuantity: 3300,
      offerQuantity: 3300,
    });
    expect(s.bids[1]!.deliveryText).toBe("240");
    expect(s.bids[1]!.submittedBy).toBe("( 0500000002 ) Mr. BETA CONTACT");
    expect(s.bids[0]!.mseStatus).toBe("MSE-GENERAL");
    expect(s.bids[0]!.answers["Dispatch Mode"]).toBe("ROAD");
  });

  it("reads every item block of a multi-item statement", () => {
    const s = parseComparativeMatrix(withSecondItem(matrix));
    expect(s.bids[0]!.items.map((i) => i.itemCode)).toEqual(["20110601001260", "20110601001999"]);
    expect(s.bids[4]!.items[1]!.basicRate).toBe(50);
  });

  it("skips a bidder's item when its basic rate cell is empty", () => {
    const s = parseComparativeMatrix(blankCell(matrix, "Basic Price Per Unit", 3));
    expect(s.bids[2]!.items).toEqual([]);
    expect(s.bids[1]!.items).toHaveLength(1);
  });

  it("treats a zero rate as not quoted", () => {
    const s = parseComparativeMatrix(setCell(matrix, "Basic Price Per Unit", 2, "0.00"));
    expect(s.bids[1]!.items).toEqual([]);
  });

  it("counts the items the statement lists, whoever quoted them", () => {
    expect(parseComparativeMatrix(matrix).itemCount).toBe(1);
    expect(parseComparativeMatrix(blankCell(withSecondItem(matrix), "Basic Price Per Unit", 1)).itemCount).toBe(2);
  });

  it("parses Indian-grouped numbers", () => {
    const s = parseComparativeMatrix(setCell(matrix, "Basic Price Per Unit", 1, "1,23,456.50"));
    expect(s.bids[0]!.items[0]!.basicRate).toBe(123456.5);
  });

  it.each([
    ["no supplier row", (m: string[][]) => m.filter((r) => r[0] !== "Supplier Name")],
    ["item block cut short", (m: string[][]) => m.filter((r) => r[0] !== "Basic Price Per Unit")],
    ["no item block at all", (m: string[][]) => m.slice(0, rowOf(m, "Sl No"))],
    ["no RFQ number", (m: string[][]) => m.filter((r) => r[0] !== "R F Q No")],
    ["empty grid", () => [] as string[][]],
  ])("rejects a statement with %s", (_name, mutate) => {
    expect(() => parseComparativeMatrix(mutate(matrix))).toThrow(StatementParseError);
  });
});
