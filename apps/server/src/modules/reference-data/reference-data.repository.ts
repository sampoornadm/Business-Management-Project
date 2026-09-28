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

/** One node of the tariff taxonomy, as it lands in the Category tree. */
export interface TaxonomyNodeInput {
  code: string;
  level: "chapter" | "heading";
  parentCode: string;
  name: string;
  officialDescription: string;
  gstRate: number | null;
  active: boolean;
  sortOrder: number;
}

export interface TaxonomySyncResult {
  chaptersCreated: number;
  headingsCreated: number;
  updated: number;
  legacyDeactivated: number;
}

export interface IReferenceDataRepository {
  upsertHsnCodes(rows: UpsertCodeInput[]): Promise<{ created: number; updated: number }>;
  /** The 6- and 8-digit rows the training corpus is built from. */
  findTariffRows(): Promise<{ code: string; description: string; codeLength: number }[]>;
  upsertSacCodes(rows: UpsertCodeInput[]): Promise<{ created: number; updated: number }>;
  findUnembeddedHsnCodes(limit: number): Promise<HsnCodeRow[]>;
  setHsnEmbedding(code: string, embedding: number[]): Promise<void>;
  findNearestHsn(queryVector: number[], codeLength: number, limit: number): Promise<HsnCandidate[]>;
  recordImport(data: RecordImportInput): Promise<void>;
  findLatestImport(dataset: string): Promise<ReferenceDataImportRow | null>;
  syncTaxonomy(nodes: TaxonomyNodeInput[]): Promise<TaxonomySyncResult>;
  setHsnGstRates(rows: { code: string; gstRate: number | null; source: string }[]): Promise<number>;
  findGstRateByCode(code: string): Promise<number | null>;
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

  findTariffRows(): Promise<{ code: string; description: string; codeLength: number }[]> {
    return this.prisma.hsnCode.findMany({
      where: { codeLength: { in: [6, 8] } },
      select: { code: true, description: true, codeLength: true },
      orderBy: { code: "asc" },
    });
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

  /**
   * Rebuilds the Category tree from the tariff taxonomy. Chapters are written first so headings can
   * resolve their parent id in the same pass.
   *
   * Existing nodes are matched by `code` and updated in place — never deleted and recreated, because
   * Item.categoryId points at these rows and re-creating them would orphan every classification.
   * Pre-tariff nodes (code IS NULL) are deactivated rather than dropped for the same reason.
   */
  async syncTaxonomy(nodes: TaxonomyNodeInput[]): Promise<TaxonomySyncResult> {
    const existing = await this.prisma.category.findMany({
      where: { code: { not: null } },
      select: { id: true, code: true, name: true, gstRate: true, active: true, officialDescription: true },
    });
    const byCode = new Map(existing.map((row) => [row.code!, row]));

    const chapters = nodes.filter((n) => n.level === "chapter");
    const headings = nodes.filter((n) => n.level === "heading");

    let chaptersCreated = 0;
    let headingsCreated = 0;
    let updated = 0;

    const differs = (node: TaxonomyNodeInput, row: (typeof existing)[number]): boolean =>
      row.name !== node.name ||
      row.gstRate !== node.gstRate ||
      row.active !== node.active ||
      row.officialDescription !== node.officialDescription;

    const newChapters = chapters.filter((n) => !byCode.has(n.code));
    if (newChapters.length > 0) {
      await this.prisma.category.createMany({
        data: newChapters.map((n) => ({
          id: randomUUID(),
          parentId: null,
          name: n.name,
          code: n.code,
          officialDescription: n.officialDescription,
          gstRate: n.gstRate,
          active: n.active,
          sortOrder: n.sortOrder,
        })),
      });
      chaptersCreated = newChapters.length;
    }

    // Re-read so newly created chapters have ids available for the heading pass.
    const chapterIdByCode = new Map(
      (
        await this.prisma.category.findMany({
          where: { parentId: null, code: { not: null } },
          select: { id: true, code: true },
        })
      ).map((row) => [row.code!, row.id]),
    );

    const newHeadings = headings.filter((n) => !byCode.has(n.code));
    if (newHeadings.length > 0) {
      await this.prisma.category.createMany({
        data: newHeadings.map((n) => ({
          id: randomUUID(),
          parentId: chapterIdByCode.get(n.parentCode) ?? null,
          name: n.name,
          code: n.code,
          officialDescription: n.officialDescription,
          gstRate: n.gstRate,
          active: n.active,
          sortOrder: n.sortOrder,
        })),
      });
      headingsCreated = newHeadings.length;
    }

    // Same reason as setHsnGstRates: on a re-run this can be 1,478 rows, and a round-trip each is
    // minutes of wall clock behind the Settings Update button.
    const changed = nodes.filter((node) => {
      const row = byCode.get(node.code);
      return row !== undefined && differs(node, row);
    });
    if (changed.length > 0) {
      updated = await this.prisma.$executeRaw`
        UPDATE categories AS c
        SET name = v.name,
            "officialDescription" = v.official_description,
            "gstRate" = v.gst_rate,
            active = v.active,
            "sortOrder" = v.sort_order,
            "updatedAt" = NOW()
        FROM (
          SELECT * FROM UNNEST(
            ${changed.map((n) => n.code)}::text[],
            ${changed.map((n) => n.name)}::text[],
            ${changed.map((n) => n.officialDescription)}::text[],
            ${changed.map((n) => n.gstRate)}::double precision[],
            ${changed.map((n) => n.active)}::boolean[],
            ${changed.map((n) => n.sortOrder)}::integer[]
          ) AS t(code, name, official_description, gst_rate, active, sort_order)
        ) AS v
        WHERE c.code = v.code
      `;
    }

    const legacy = await this.prisma.category.updateMany({
      where: { code: null, active: true },
      data: { active: false },
    });

    return { chaptersCreated, headingsCreated, updated, legacyDeactivated: legacy.count };
  }

  /**
   * The GST rate for a resolved HSN code. Null when the sheet carries no rate for it, which the
   * caller must treat as "unknown" — inventing a rate is what this whole change exists to stop.
   */
  async findGstRateByCode(code: string): Promise<number | null> {
    const row = await this.prisma.hsnCode.findUnique({
      where: { code },
      select: { gstRate: true },
    });
    return row?.gstRate ?? null;
  }

  /**
   * Copies rates from the lookup sheet onto the HSN codes themselves, for direct code -> rate reads.
   *
   * One statement, not one per code: there are 1,348 four-digit headings and this runs behind the
   * Settings Update button, where a round-trip each turned a second of work into six minutes.
   */
  async setHsnGstRates(rows: { code: string; gstRate: number | null; source: string }[]): Promise<number> {
    if (rows.length === 0) return 0;

    const codes = rows.map((r) => r.code);
    const rates = rows.map((r) => r.gstRate);
    const sources = rows.map((r) => r.source);

    // UNNEST turns the three arrays into a join table; IS DISTINCT FROM keeps the null-safe
    // "only touch rows that actually changed" behaviour, so the count stays meaningful.
    const updated = await this.prisma.$executeRaw`
      UPDATE hsn_codes AS h
      SET "gstRate" = v.rate, "gstRateSource" = v.source, "updatedAt" = NOW()
      FROM (
        SELECT * FROM UNNEST(
          ${codes}::text[], ${rates}::double precision[], ${sources}::text[]
        ) AS t(code, rate, source)
      ) AS v
      WHERE h.code = v.code
        AND (h."gstRate" IS DISTINCT FROM v.rate OR h."gstRateSource" IS DISTINCT FROM v.source)
    `;
    return updated;
  }
}
