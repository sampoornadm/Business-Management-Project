export interface ParsedBidItem {
  slNo: string;
  itemCode: string;
  description: string;
  unit: string | null;
  rfqQuantity: number | null;
  offerQuantity: number | null;
  basicRate: number;
  landedRate: number | null;
}

export interface ParsedBid {
  vendorCode: string;
  vendorName: string;
  submittedBy: string | null;
  quotationRef: string;
  total: number | null;
  deliveryText: string | null;
  mseStatus: string | null;
  answers: Record<string, string>;
  items: ParsedBidItem[];
}

export interface ParsedStatement {
  rfxNumber: string;
  description: string | null;
  bidStart: Date | null;
  bidEnd: Date | null;
  basisOfEvaluation: string | null;
  /** Items the statement lists, whoever quoted them; a bid covering fewer is a partial bid. */
  itemCount: number;
  bids: ParsedBid[];
}

/** The grid is not a comparative statement we can trust; nothing from it may be stored. */
export class StatementParseError extends Error {}

const HEADER_LEVEL = "QUOTATION DETAIL(S) : R F Q HEADER LEVEL";
const ITEM_LEVEL = "QUOTATION DETAIL(S) : R F Q ITEM LEVEL";
const SUPPLIER = "Supplier Name";
const SUBMITTED_BY = "Submitted By";
// The portal itself misspells this label ("Qutotation"); accept either spelling.
const QUOTATION_REF = /^Qu\w*tation Reference No$/i;
const TOTAL = "Total LCNITC(As Quoted)";
const MSE_STATUS = "If MSE Provide Status ?";
const DELIVERY = /^Delivery period from the date of order placement/i;

const label = (row: string[] | undefined) => (row?.[0] ?? "").trim();
const text = (value: string | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

function number(value: string | undefined): number | null {
  const cleaned = (value ?? "").replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `23.10.2026 15 : 00 : 00`, portal local time (IST). */
function istDate(value: string | undefined): Date | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2})\s*:\s*(\d{1,2})\s*:\s*(\d{1,2})$/.exec((value ?? "").trim());
  if (!match) return null;
  const [, day, month, year, hour, minute, second] = match;
  const pad = (part: string | undefined) => (part ?? "").padStart(2, "0");
  const date = new Date(`${year}-${month}-${day}T${pad(hour)}:${pad(minute)}:${pad(second)}+05:30`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Reads the SAIL ISP comparative statement grid. The grid is transposed: `matrix[row][0]` is a
 * field label and each further column is one bidder (the RFQ details rows keep their value in
 * column 1). Values are always taken by column, because a bidder's cell may be empty.
 */
export function parseComparativeMatrix(matrix: string[][]): ParsedStatement {
  const headerStart = matrix.findIndex((row) => label(row) === HEADER_LEVEL);
  const itemStart = matrix.findIndex((row) => label(row) === ITEM_LEVEL);
  if (headerStart < 0 || itemStart < headerStart) {
    throw new StatementParseError("the quotation sections are missing");
  }
  const details = matrix.slice(0, headerStart);
  const header = matrix.slice(headerStart + 1, itemStart);
  const itemRows = matrix.slice(itemStart + 1);

  const detail = (name: string) => text(details.find((row) => label(row) === name)?.[1]);
  const rfxNumber = detail("R F Q No");
  if (!rfxNumber) throw new StatementParseError("the RFQ number is missing");

  const suppliers = header.find((row) => label(row) === SUPPLIER);
  if (!suppliers) throw new StatementParseError("the supplier row is missing");
  const columns = suppliers.flatMap((cell, column) => (column > 0 && cell.trim() !== "" ? [column] : []));
  if (columns.length === 0) throw new StatementParseError("no bidders are listed");

  const headerRow = (match: (name: string) => boolean) => header.find((row) => match(label(row)));
  const quotationRefs = headerRow((name) => QUOTATION_REF.test(name));
  const submittedBy = headerRow((name) => name === SUBMITTED_BY);
  const totals = headerRow((name) => name === TOTAL);
  const mse = headerRow((name) => name === MSE_STATUS);
  const delivery = headerRow((name) => DELIVERY.test(name));
  const answerRows = header.filter((row) => {
    const name = label(row);
    return name !== "" && name !== SUPPLIER && name !== SUBMITTED_BY && !QUOTATION_REF.test(name);
  });

  const blockStarts = itemRows.flatMap((row, index) => (label(row) === "Sl No" ? [index] : []));
  if (blockStarts.length === 0) throw new StatementParseError("no items are listed");
  const blocks = blockStarts.map((start, index) => {
    const rows = itemRows.slice(start, blockStarts[index + 1] ?? itemRows.length);
    const field = (name: string) => rows.find((row) => label(row) === name);
    const itemCode = field("Item Code");
    const basicRate = field("Basic Price Per Unit");
    if (!itemCode || !basicRate) {
      throw new StatementParseError(`item ${index + 1} is incomplete, the grid may not have loaded fully`);
    }
    return {
      slNo: rows[0]!,
      itemCode,
      basicRate,
      description: field("Item Description"),
      unit: field("Item UoM"),
      rfqQuantity: field("RFQ Item Quantity"),
      offerQuantity: field("Offer Quantity"),
      landedRate: field("Landed Cost Per Unit ( INR )"),
    };
  });

  const bids = columns.map((column): ParsedBid => {
    const supplier = /^\(\s*(\d+)\s*\)\s*(.+)$/.exec(suppliers[column]!.trim());
    if (!supplier) throw new StatementParseError(`cannot read the supplier "${suppliers[column]}"`);
    const quotationRef = text(quotationRefs?.[column]);
    if (!quotationRef) throw new StatementParseError(`${supplier[2]} has no quotation reference number`);

    const answers: Record<string, string> = {};
    for (const row of answerRows) {
      const value = text(row[column]);
      if (value !== null) answers[label(row)] = value;
    }

    const items = blocks.flatMap((block): ParsedBidItem[] => {
      const itemCode = text(block.itemCode[column]);
      const basicRate = number(block.basicRate[column]);
      // An empty (or zero) rate cell means this bidder did not quote the item.
      if (itemCode === null || basicRate === null || basicRate <= 0) return [];
      return [
        {
          slNo: text(block.slNo[column]) ?? "",
          itemCode,
          description: text(block.description?.[column]) ?? "",
          unit: text(block.unit?.[column]),
          rfqQuantity: number(block.rfqQuantity?.[column]),
          offerQuantity: number(block.offerQuantity?.[column]),
          basicRate,
          landedRate: number(block.landedRate?.[column]),
        },
      ];
    });

    return {
      vendorCode: supplier[1]!,
      vendorName: supplier[2]!.trim(),
      submittedBy: text(submittedBy?.[column]),
      quotationRef,
      total: number(totals?.[column]),
      deliveryText: text(delivery?.[column]),
      mseStatus: text(mse?.[column]),
      answers,
      items,
    };
  });

  return {
    rfxNumber,
    description: detail("DESCRIPTION"),
    bidStart: istDate(detail("BID Start Date") ?? undefined),
    bidEnd: istDate(detail("BID End Date") ?? undefined),
    basisOfEvaluation: detail("Basis of Evaluation"),
    itemCount: blocks.length,
    bids,
  };
}
