import { spawn } from "node:child_process";

/**
 * Extracts text from a PDF buffer via poppler's `pdftotext` CLI (stdin in, stdout out) instead
 * of the `pdf-parse` npm package — pdf-parse@1.1.4's bundled pdf.js throws on real PDFs when
 * loaded through this app's module loaders (tsx in production, Vite in vitest), confirmed with
 * three different PDFs each failing with a different internal pdf.js error, while every one of
 * them extracts correctly via pdftotext and via plain `node -e require("pdf-parse")` (a bundler
 * interaction, not a PDF-content problem). Requires poppler-utils installed on the host/image.
 */
export function extractPdfText(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    // timeout: two call sites (BOQ parse, tender extraction) are synchronous user-upload request
    // paths — a PDF that makes pdftotext hang would hold the HTTP request open forever. Node
    // SIGTERMs the child on timeout, which fires the `close` handler below with a non-zero/null
    // code and rejects like any other pdftotext failure.
    const child = spawn("pdftotext", ["-", "-"], { timeout: 30_000 });
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
