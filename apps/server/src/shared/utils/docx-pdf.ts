import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";

/**
 * Converts a .docx buffer to PDF by shelling out to LibreOffice's `soffice` CLI — the same
 * subprocess-over-npm-package pattern as pdf-text.ts's pdftotext, and chosen for the same kind of
 * reason: the generated documents here (the Undertaking) live in a business's own .docx template,
 * letterhead image and all, so re-drawing them with pdfkit (as quotation-document.ts does for a
 * document it builds itself) would fork the legal text away from the template that owns it.
 * Requires LibreOffice wherever the server/worker runs: `brew install --cask libreoffice` locally,
 * `apk add libreoffice` in apps/server/Dockerfile's runner stage.
 */
export async function convertDocxToPdf(docx: Buffer): Promise<Buffer> {
  const workDir = await mkdtemp(path.join(tmpdir(), "bmp-docx-pdf-"));
  try {
    const input = path.join(workDir, "document.docx");
    await writeFile(input, docx);
    await runSoffice(input, workDir);
    try {
      return await readFile(path.join(workDir, "document.pdf"));
    } catch {
      // soffice exits 0 even when it silently converts nothing (an unreadable file, a profile it
      // could not create), so a missing output file is the real failure signal, not the exit code.
      throw new ServiceUnavailableError("LibreOffice produced no PDF for this document");
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function runSoffice(inputPath: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "soffice",
      [
        // Every call gets a throwaway user profile. With the default shared one, a conversion
        // fails outright while a desktop LibreOffice is open on the same machine, and two
        // concurrent requests fight over the same profile lock.
        `-env:UserInstallation=${pathToFileURL(path.join(outDir, "profile")).href}`,
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        outDir,
        inputPath,
      ],
      // Generous: the first run in a fresh container builds the user profile before converting
      // anything. This is a synchronous download request path, so it still must not hang forever.
      { timeout: 120_000 },
    );
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) =>
      reject(new ServiceUnavailableError(`LibreOffice (soffice) is not available: ${err.message}`)),
    );
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new ServiceUnavailableError(`LibreOffice exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      resolve();
    });
  });
}
