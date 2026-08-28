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
    const child = spawn("pdftotext", ["-", "-"]);
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

    child.stdin.write(buffer);
    child.stdin.end();
  });
}
