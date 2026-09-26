import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { embedMock } = vi.hoisted(() => ({ embedMock: vi.fn() }));
vi.mock("../../../infra/llm/ollama.client.js", () => ({ embed: embedMock }));

import { HsnSacImportService, OLLAMA_EMBED_CHUNK_SIZE, parseHsnSacWorkbook } from "../hsn-sac-import.service.js";
import type { HsnCodeRow, IReferenceDataRepository, UpsertCodeInput } from "../reference-data.repository.js";

async function buildFixtureWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const hsn = workbook.addWorksheet("HSN_MSTR");
  hsn.addRow(["HSN_CD", "HSN_Description"]);
  hsn.addRow(["73", "ARTICLES OF IRON OR STEEL"]);
  hsn.addRow(["7307", "TUBE OR PIPE FITTINGS, OF IRON OR STEEL"]);
  const sac = workbook.addWorksheet("SAC_MSTR");
  sac.addRow(["SAC_CD", "SAC_Description"]);
  sac.addRow(["9954", "Construction services"]);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe("parseHsnSacWorkbook", () => {
  it("parses both sheets, skips the header row, and derives codeLength from code length", async () => {
    const buffer = await buildFixtureWorkbook();
    const parsed = await parseHsnSacWorkbook(buffer);

    expect(parsed.hsnRows).toEqual([
      { code: "73", description: "ARTICLES OF IRON OR STEEL", codeLength: 2 },
      { code: "7307", description: "TUBE OR PIPE FITTINGS, OF IRON OR STEEL", codeLength: 4 },
    ]);
    expect(parsed.sacRows).toEqual([
      { code: "9954", description: "Construction services", codeLength: 4 },
    ]);
  });
});

class FakeReferenceDataRepository implements Partial<IReferenceDataRepository> {
  hsnRows = new Map<string, UpsertCodeInput>();
  sacRows = new Map<string, UpsertCodeInput>();
  embedded = new Map<string, number[]>();
  imports: unknown[] = [];

  async upsertHsnCodes(rows: UpsertCodeInput[]) {
    let created = 0;
    let updated = 0;
    for (const row of rows) {
      if (this.hsnRows.has(row.code)) updated += 1;
      else created += 1;
      this.hsnRows.set(row.code, row);
    }
    return { created, updated };
  }

  async upsertSacCodes(rows: UpsertCodeInput[]) {
    for (const row of rows) this.sacRows.set(row.code, row);
    return { created: rows.length, updated: 0 };
  }

  async findUnembeddedHsnCodes(limit: number): Promise<HsnCodeRow[]> {
    return [...this.hsnRows.values()]
      .filter((r) => r.codeLength === 4 && !this.embedded.has(r.code))
      .slice(0, limit)
      .map((r) => ({ code: r.code, description: r.description }));
  }

  async setHsnEmbedding(code: string, embedding: number[]) {
    this.embedded.set(code, embedding);
  }

  async recordImport(data: unknown) {
    this.imports.push(data);
  }
}

describe("HsnSacImportService.importFromBuffer", () => {
  let repository: FakeReferenceDataRepository;
  let service: HsnSacImportService;

  beforeEach(() => {
    embedMock.mockReset();
    repository = new FakeReferenceDataRepository();
    service = new HsnSacImportService(repository as unknown as IReferenceDataRepository);
  });

  it("upserts both sheets, records the import, and embeds only 4-digit HSN rows", async () => {
    const buffer = await buildFixtureWorkbook();
    embedMock.mockResolvedValue([[0.1, 0.2]]);

    const result = await service.importFromBuffer(buffer, "https://example.test/HSN_SAC.xlsx", "etag-1", null);

    expect(result).toEqual({ hsnRowCount: 2, sacRowCount: 1 });
    expect(repository.hsnRows.size).toBe(2);
    expect(repository.sacRows.size).toBe(1);
    expect(repository.imports).toHaveLength(1);
    // Only the 4-digit row (7307) gets embedded — the 2-digit chapter row (73) does not.
    expect(embedMock).toHaveBeenCalledWith(["TUBE OR PIPE FITTINGS, OF IRON OR STEEL"]);
    expect(repository.embedded.has("7307")).toBe(true);
    expect(repository.embedded.has("73")).toBe(false);
  });

  it("rejects a workbook with no readable HSN_MSTR rows", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("HSN_MSTR").addRow(["HSN_CD", "HSN_Description"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(service.importFromBuffer(buffer, "https://example.test", null, null)).rejects.toThrow(
      "HSN_SAC workbook had no readable HSN_MSTR rows.",
    );
    expect(repository.imports).toHaveLength(0);
  });

  it("still upserts and records the import when Ollama is unavailable during embedding", async () => {
    const buffer = await buildFixtureWorkbook();
    embedMock.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    const result = await service.importFromBuffer(buffer, "https://example.test", "etag-1", null);

    expect(result).toEqual({ hsnRowCount: 2, sacRowCount: 1 });
    expect(repository.imports).toHaveLength(1);
    expect(repository.embedded.size).toBe(0);
  });

  it("chunks embedding calls so a single Ollama request never gets an oversized batch", async () => {
    // Ollama's local runner has been observed to drop the connection (EOF from its internal
    // tokenize call) on a single 500+-item /api/embed request on this hardware — chunking is a
    // real, measured constraint, not speculative.
    const workbook = new ExcelJS.Workbook();
    const hsn = workbook.addWorksheet("HSN_MSTR");
    hsn.addRow(["HSN_CD", "HSN_Description"]);
    const rowCount = OLLAMA_EMBED_CHUNK_SIZE + 5;
    for (let i = 0; i < rowCount; i++) {
      hsn.addRow([String(1000 + i), `Description ${i}`]);
    }
    workbook.addWorksheet("SAC_MSTR").addRow(["SAC_CD", "SAC_Description"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    embedMock.mockImplementation(async (texts: string[]) => texts.map(() => [0.1, 0.2]));

    await service.importFromBuffer(buffer, "https://example.test", null, null);

    expect(embedMock).toHaveBeenCalledTimes(2);
    expect(embedMock.mock.calls[0]?.[0]).toHaveLength(OLLAMA_EMBED_CHUNK_SIZE);
    expect(embedMock.mock.calls[1]?.[0]).toHaveLength(5);
    expect(repository.embedded.size).toBe(rowCount);
  });

  it("does not re-embed a row that's already embedded and whose description hasn't changed", async () => {
    const buffer = await buildFixtureWorkbook();
    embedMock.mockResolvedValue([[0.1, 0.2]]);

    await service.importFromBuffer(buffer, "https://example.test", "etag-1", null);
    expect(embedMock).toHaveBeenCalledTimes(1);

    embedMock.mockClear();
    await service.importFromBuffer(buffer, "https://example.test", "etag-2", null);

    expect(embedMock).not.toHaveBeenCalled();
  });
});
