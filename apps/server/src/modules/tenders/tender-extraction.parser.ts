import mammoth from "mammoth";

import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { extractPdfText, type ExtractPdfTextOptions } from "../../shared/utils/pdf-text.js";
import { cellToText, loadWorkbook, pickDataWorksheet } from "../../shared/utils/xlsx.js";

/** One physical line per table row, cells separated — see TABLE_CELL_SEPARATOR. */
export const TABLE_CELL_SEPARATOR = "\t";

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * Via HTML rather than mammoth's own `extractRawText`, purely to keep TABLES intact:
 * extractRawText emits every table CELL as its own paragraph, which destroys row boundaries —
 * a real "TnC" tender document's 9-item table came out as 60-odd orphan lines with no way to
 * tell which description belonged to which quantity. Converting to HTML first keeps `<tr>`/`<td>`
 * markers, so each row can be rebuilt onto one line, matching the one-row-per-line shape that
 * pdftotext `-layout` already gives the PDF path (see pdf-text.ts).
 *
 * Images are converted to an empty `<img>`: mammoth's default inlines every picture as a base64
 * data URI, which turned a 410 KB document into megabytes of prompt-poisoning noise.
 */
async function extractDocxText(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.convertToHtml(
    { buffer },
    { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })) },
  );

  return value
    // Cell first, so a `<p>` INSIDE a cell doesn't break the row onto several lines.
    .replace(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g, (_, inner: string) =>
      `${inner.replace(/<\/p>/g, " ")}${TABLE_CELL_SEPARATOR}`,
    )
    .replace(/<\/(?:tr|p|li|h[1-6])>/g, "\n")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z]+;|&#\d+;/g, (entity) => HTML_ENTITIES[entity] ?? entity)
    .split("\n")
    .map((line) => line.replace(/[^\S\t]+/g, " ").replace(/(?:\s*\t)+\s*$/, "").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Same one-row-per-line shape as the PDF and DOCX paths, so a single downstream parser handles
 * all three. Supplier "quotation response form" workbooks are the reason this exists: the item
 * grid arrives as a real spreadsheet, not prose.
 */
async function extractXlsxText(buffer: Buffer): Promise<string> {
  const workbook = await loadWorkbook(buffer);
  const worksheet = pickDataWorksheet(workbook);
  if (!worksheet) throw new BadRequestError("The uploaded workbook has no worksheets");

  const lines: string[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let colNumber = 1; colNumber <= worksheet.columnCount; colNumber++) {
      cells.push(cellToText(row.getCell(colNumber).value).replace(/\s+/g, " ").trim());
    }
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    if (cells.some((cell) => cell !== "")) lines.push(cells.join(TABLE_CELL_SEPARATOR));
  });
  return lines.join("\n");
}

// Returns the FULL extracted text, untruncated — a multi-page document's
// item table can run well past any reasonable prompt-size cutoff (verified:
// a 9-page, 13-item document's last item fell past a 12,000-char truncation
// point, silently dropping its description). Truncation for the LLM prompt
// is the caller's concern, applied only to what it sends the model — the
// deterministic item parser always sees everything.
//
// `options.layout` only affects the PDF branch (passed straight through to
// pdftotext's `-layout` flag) — the DOCX and XLSX branches read real table
// markup, so they are already row-per-line and ignore it. See
// pdf-text.ts#ExtractPdfTextOptions for why the PDF caller needs to choose
// per use (header fields vs. the item table).
export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  options?: ExtractPdfTextOptions,
): Promise<string> {
  let text: string;
  if (mimeType === "application/pdf") {
    text = await extractPdfText(buffer, options);
  } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    text = await extractDocxText(buffer);
  } else if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    text = await extractXlsxText(buffer);
  } else {
    throw new BadRequestError(
      "Unsupported file type for tender extraction. Upload a PDF, Word (.docx) or Excel (.xlsx) document.",
    );
  }

  return text.trim();
}
