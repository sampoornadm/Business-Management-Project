import ExcelJS from "exceljs";

import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";
import { embed } from "../../infra/llm/ollama.client.js";
import { logger } from "../../shared/logger/logger.js";

import type { IReferenceDataRepository, UpsertCodeInput } from "./reference-data.repository.js";

export const CBIC_HSN_SAC_URL = "https://tutorial.gst.gov.in/downloads/HSN_SAC.xlsx";
const DATASET_NAME = "HSN_SAC";
/** How many still-unembedded 4-digit HSN headings get embedded per import pass. */
const EMBED_BATCH_LIMIT = 2000;
/**
 * Max texts sent to Ollama's /api/embed in one call. Measured, not speculative: a single
 * 500+-item request against this app's local bge-m3 runner drops the connection (the runner's
 * internal tokenize call returns EOF — an OOM/crash symptom, not a documented API limit) while
 * 200 succeeds reliably. Comfortably under that observed failure point, with margin since the
 * real ceiling is hardware-dependent, not a fixed constant.
 */
export const OLLAMA_EMBED_CHUNK_SIZE = 150;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export interface ParsedWorkbook {
  hsnRows: UpsertCodeInput[];
  sacRows: UpsertCodeInput[];
}

function parseSheet(sheet: ExcelJS.Worksheet | undefined): UpsertCodeInput[] {
  if (!sheet) return [];
  const rows: UpsertCodeInput[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const code = String(row.getCell(1).value ?? "").trim();
    const description = String(row.getCell(2).value ?? "").trim();
    if (!code || !description) return;
    rows.push({ code, description, codeLength: code.length });
  });
  return rows;
}

export async function parseHsnSacWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  // exceljs@4.4.0's bundled types predate @types/node's generic Buffer<TArrayBuffer>, so its
  // declared `Buffer` and the workspace's resolved `Buffer` are two structurally different
  // interfaces — a real Buffer at runtime still fails this check. Casting to the parameter type
  // exceljs's own signature actually declares (rather than the ambient global `Buffer`) matches
  // by construction regardless of which Buffer declaration is in scope where.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return {
    hsnRows: parseSheet(workbook.getWorksheet("HSN_MSTR")),
    sacRows: parseSheet(workbook.getWorksheet("SAC_MSTR")),
  };
}

export class HsnSacImportService {
  constructor(private readonly referenceDataRepository: IReferenceDataRepository) {}

  async importFromBuffer(
    buffer: Buffer,
    sourceUrl: string,
    sourceEtag: string | null,
    triggeredById: string | null,
  ): Promise<{ hsnRowCount: number; sacRowCount: number }> {
    const { hsnRows, sacRows } = await parseHsnSacWorkbook(buffer);
    if (hsnRows.length === 0) {
      throw new ServiceUnavailableError("HSN_SAC workbook had no readable HSN_MSTR rows.");
    }

    await this.referenceDataRepository.upsertHsnCodes(hsnRows);
    await this.referenceDataRepository.upsertSacCodes(sacRows);
    await this.referenceDataRepository.recordImport({
      dataset: DATASET_NAME,
      sourceUrl,
      sourceEtag,
      hsnRowCount: hsnRows.length,
      sacRowCount: sacRows.length,
      triggeredById,
    });

    await this.embedPendingHsnCodes();

    return { hsnRowCount: hsnRows.length, sacRowCount: sacRows.length };
  }

  /**
   * Embeds every still-unembedded 4-digit HSN heading — the only rows the matching engine
   * queries. A failure here must not undo the upsert/record above — the rows just stay
   * unembedded for the next pass to pick up (same "one bad step doesn't abandon the rest" rule
   * boq-enrichment.service.ts#enrichBoq already follows).
   */
  private async embedPendingHsnCodes(): Promise<void> {
    const pending = await this.referenceDataRepository.findUnembeddedHsnCodes(EMBED_BATCH_LIMIT);
    if (pending.length === 0) return;

    let embedded = 0;
    for (const batch of chunk(pending, OLLAMA_EMBED_CHUNK_SIZE)) {
      let vectors: number[][];
      try {
        vectors = await embed(batch.map((row) => row.description));
      } catch (err) {
        // Abort the remaining chunks too — a failure here is Ollama being unreachable, not a
        // per-chunk problem, so retrying more chunks would just repeat the same failure. The
        // rows in this and later chunks stay unembedded for the next pass to pick up (same
        // "one bad step doesn't abandon the rest" rule boq-enrichment.service.ts#enrichBoq
        // follows for the BOQ it's mid-way through, one level up).
        logger.warn({ err, embedded, remaining: pending.length - embedded }, "Stopped HSN embedding pass (Ollama unavailable)");
        return;
      }
      for (const [index, row] of batch.entries()) {
        const vector = vectors[index];
        if (vector) await this.referenceDataRepository.setHsnEmbedding(row.code, vector);
      }
      embedded += batch.length;
    }
    logger.info({ count: embedded }, "Embedded HSN codes");
  }

  async fetchAndImport(
    triggeredById: string | null,
  ): Promise<{ hsnRowCount: number; sacRowCount: number } | null> {
    const latest = await this.referenceDataRepository.findLatestImport(DATASET_NAME);
    const headers: Record<string, string> = {};
    if (latest?.sourceEtag) headers["If-None-Match"] = latest.sourceEtag;

    const response = await fetch(CBIC_HSN_SAC_URL, { headers });
    if (response.status === 304) {
      logger.info("HSN/SAC source unchanged, skipping import");
      return null;
    }
    if (!response.ok) {
      throw new ServiceUnavailableError(`Could not fetch HSN/SAC master list (HTTP ${response.status}).`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const etag = response.headers.get("etag");
    return this.importFromBuffer(buffer, CBIC_HSN_SAC_URL, etag, triggeredById);
  }
}
