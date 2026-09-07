import { spawn } from "node:child_process";

/**
 * Extracts text from a PDF buffer via poppler's `pdftotext` CLI (stdin in, stdout out) instead
 * of the `pdf-parse` npm package — pdf-parse@1.1.4's bundled pdf.js throws on real PDFs when
 * loaded through this app's module loaders (tsx in production, Vite in vitest), confirmed with
 * three different PDFs each failing with a different internal pdf.js error, while every one of
 * them extracts correctly via pdftotext and via plain `node -e require("pdf-parse")` (a bundler
 * interaction, not a PDF-content problem). Requires poppler-utils installed on the host/image.
 */
export interface ExtractPdfTextOptions {
  /**
   * Pass `-layout` through to pdftotext: keeps each visual row on one physical
   * line instead of pdftotext's default one-cell-per-line, reading-order-based
   * splitting. Needed for parsing tables (e.g. tender-item.parser.ts) — the
   * default mode's cell ordering scrambles near a page break (a table row's
   * cells can get reordered or interleaved with the next page's letterhead),
   * confirmed against a real 9-page/13-item document where it silently
   * dropped 8 of 13 items. `-layout` keeps every row intact across page
   * breaks. Not the default for every caller: tender-header.parser.ts's
   * regexes are written against (and verified only against) the default
   * mode's columns-before-rows shape and would break under `-layout`.
   */
  layout?: boolean;
}

export function extractPdfText(buffer: Buffer, options?: ExtractPdfTextOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    // timeout: two call sites (BOQ parse, tender extraction) are synchronous user-upload request
    // paths — a PDF that makes pdftotext hang would hold the HTTP request open forever. Node
    // SIGTERMs the child on timeout, which fires the `close` handler below with a non-zero/null
    // code and rejects like any other pdftotext failure.
    const args = options?.layout ? ["-layout", "-", "-"] : ["-", "-"];
    const child = spawn("pdftotext", args, { timeout: 30_000 });
    const stdout: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(new Error(`pdftotext not available: ${err.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`pdftotext exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });

    // A child that dies before draining stdin (killed by the timeout above, or exiting early on a
    // malformed file) makes this write emit EPIPE — unhandled, that's an *uncaught exception* that
    // takes the process down, not a rejected promise. Swallow it: the real failure is already
    // reported through the `close` handler's non-zero exit code.
    child.stdin.on("error", () => {});
    child.stdin.write(buffer);
    child.stdin.end();
  });
}
