import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@bmp/database";

export interface UpsertCodeInput {
  code: string;
  description: string;
  codeLength: number;
}

export interface HsnCodeRow {
  code: string;
  description: string;
}

export interface HsnCandidate {
  code: string;
  description: string;
  similarity: number;
}

export interface RecordImportInput {
  dataset: string;
  sourceUrl: string;
  sourceEtag: string | null;
  hsnRowCount: number;
  sacRowCount: number;
  triggeredById: string | null;
}

export interface ReferenceDataImportRow {
  id: string;
  dataset: string;
  sourceUrl: string;
  sourceEtag: string | null;
  hsnRowCount: number;
  sacRowCount: number;
  importedAt: Date;
  triggeredBy: { id: string; firstName: string; lastName: string } | null;
}

const importWithTriggeredByArgs = {
  include: { triggeredBy: { select: { id: true, firstName: true, lastName: true } } },
} satisfies Prisma.ReferenceDataImportDefaultArgs;

export interface IReferenceDataRepository {
  upsertHsnCodes(rows: UpsertCodeInput[]): Promise<{ created: number; updated: number }>;
  upsertSacCodes(rows: UpsertCodeInput[]): Promise<{ created: number; updated: number }>;
  findUnembeddedHsnCodes(limit: number): Promise<HsnCodeRow[]>;
  setHsnEmbedding(code: string, embedding: number[]): Promise<void>;
  findNearestHsn(queryVector: number[], codeLength: number, limit: number): Promise<HsnCandidate[]>;
  recordImport(data: RecordImportInput): Promise<void>;
  findLatestImport(dataset: string): Promise<ReferenceDataImportRow | null>;
}

export class ReferenceDataRepository implements IReferenceDataRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertHsnCodes(rows: UpsertCodeInput[]): Promise<{ created: number; updated: number }> {
    const existing = await this.prisma.hsnCode.findMany({ select: { code: true, description: true } });
    const existingByCode = new Map(existing.map((e) => [e.code, e.description]));

    const toCreate = rows.filter((r) => !existingByCode.has(r.code));
    const toUpdate = rows.filter(
      (r) => existingByCode.has(r.code) && existingByCode.get(r.code) !== r.description,
    );

    if (toCreate.length > 0) {
      await this.prisma.hsnCode.createMany({ data: toCreate.map((r) => ({ id: randomUUID(), ...r })) });
    }
    for (const row of toUpdate) {
      // A changed description clears embeddedAt so findUnembeddedHsnCodes picks it back up —
      // the stale embeddingVector sits unused until the next embedding pass overwrites it.
      await this.prisma.hsnCode.update({
        where: { code: row.code },
        data: { description: row.description, codeLength: row.codeLength, embeddedAt: null },
      });
    }
    return { created: toCreate.length, updated: toUpdate.length };
  }

  async upsertSacCodes(rows: UpsertCodeInput[]): Promise<{ created: number; updated: number }> {
    const existing = await this.prisma.sacCode.findMany({ select: { code: true, description: true } });
    const existingByCode = new Map(existing.map((e) => [e.code, e.description]));

    const toCreate = rows.filter((r) => !existingByCode.has(r.code));
    const toUpdate = rows.filter(
      (r) => existingByCode.has(r.code) && existingByCode.get(r.code) !== r.description,
    );

    if (toCreate.length > 0) {
      await this.prisma.sacCode.createMany({ data: toCreate.map((r) => ({ id: randomUUID(), ...r })) });
    }
    for (const row of toUpdate) {
      await this.prisma.sacCode.update({
        where: { code: row.code },
        data: { description: row.description, codeLength: row.codeLength, embeddedAt: null },
      });
    }
    return { created: toCreate.length, updated: toUpdate.length };
  }

  findUnembeddedHsnCodes(limit: number): Promise<HsnCodeRow[]> {
    return this.prisma.hsnCode.findMany({
      where: { codeLength: 4, embeddedAt: null },
      select: { code: true, description: true },
      take: limit,
    });
  }

  async setHsnEmbedding(code: string, embedding: number[]): Promise<void> {
    const vectorLiteral = `[${embedding.join(",")}]`;
    await this.prisma.$transaction([
      this.prisma.hsnCode.update({ where: { code }, data: { embedding, embeddedAt: new Date() } }),
      this.prisma
        .$executeRaw`UPDATE hsn_codes SET "embeddingVector" = ${vectorLiteral}::vector WHERE code = ${code}`,
    ]);
  }

  findNearestHsn(queryVector: number[], codeLength: number, limit: number): Promise<HsnCandidate[]> {
    const vectorLiteral = `[${queryVector.join(",")}]`;
    return this.prisma.$queryRaw`
      SELECT code, description,
             1 - ("embeddingVector" <=> ${vectorLiteral}::vector) AS similarity
      FROM hsn_codes
      WHERE "codeLength" = ${codeLength} AND "embeddingVector" IS NOT NULL
      ORDER BY "embeddingVector" <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;
  }

  async recordImport(data: RecordImportInput): Promise<void> {
    await this.prisma.referenceDataImport.create({
      data: { id: randomUUID(), ...data },
    });
  }

  findLatestImport(dataset: string): Promise<ReferenceDataImportRow | null> {
    return this.prisma.referenceDataImport.findFirst({
      where: { dataset },
      orderBy: { importedAt: "desc" },
      ...importWithTriggeredByArgs,
    });
  }
}
