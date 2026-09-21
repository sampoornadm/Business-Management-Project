import type { Prisma, PrismaClient, PurchaseOrderStatus, RfqStatus, TenderStatus } from "@bmp/database";
import type { AssistantDateRangeDto, AssistantQueryState } from "@bmp/types";

/**
 * Read-only retrieval for the assistant. Everything here is plain Prisma with `businessId` in the
 * base clause — the model never writes SQL, so tenant scoping cannot be talked out of the query.
 * Item text is matched against *current* BOQ items only (older BOQ versions keep their rows and
 * would otherwise produce stale/duplicate hits).
 */

export type AssistantHitType = "Tender" | "Rfq" | "PurchaseOrder" | "Bill";

export interface AssistantHit {
  type: AssistantHitType;
  id: string;
  title: string;
  /** Tender / PO / bill number, when the kind has one. */
  reference: string | null;
  status: string | null;
  /** Which date `date` is ("Quoted", "Created", "Due"...), shown next to it. */
  dateLabel: string;
  date: Date | null;
  party: string | null;
  /** First item line that matched the search terms, as evidence for why this result appeared. */
  matchedItem: string | null;
}

export interface AssistantKindResult {
  total: number;
  hits: AssistantHit[];
}

export interface IAssistantRepository {
  findTenders(state: AssistantQueryState, businessId: string, limit: number): Promise<AssistantKindResult>;
  findRfqs(state: AssistantQueryState, businessId: string, limit: number): Promise<AssistantKindResult>;
  findPurchaseOrders(state: AssistantQueryState, businessId: string, limit: number): Promise<AssistantKindResult>;
  findBills(state: AssistantQueryState, businessId: string, limit: number): Promise<AssistantKindResult>;
}

// ---------- where-clause building blocks (exported for unit tests) ----------

const contains = (value: string) => ({ contains: value, mode: "insensitive" as const });

/**
 * One term matches a line when every word of it appears in one of `fields` ("flat washer M8"
 * matches "M8 washer, flat"); the term list is any-of.
 */
export function itemTermsWhere<F extends string>(terms: readonly string[], fields: readonly F[]) {
  type WordMatch = Partial<Record<F, ReturnType<typeof contains>>>;
  return {
    OR: terms.map((term) => {
      const words = term.split(/\s+/).filter(Boolean);
      return {
        OR: fields.map((field) => ({ AND: words.map((word) => ({ [field]: contains(word) }) as WordMatch) })),
      };
    }),
  };
}

function rangeWhere(range: AssistantDateRangeDto | null): { gte: Date; lt: Date } | undefined {
  return range ? { gte: new Date(range.from), lt: new Date(range.to) } : undefined;
}

/** "quoted" is a tender-only concept; for every other kind it means "created". */
const otherKindsDateField = (state: AssistantQueryState): "created" | "deadline" =>
  state.dateField === "deadline" ? "deadline" : "created";

const CHUNK = 5000;

export class AssistantRepository implements IAssistantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------- tenders ----------

  async findTenders(state: AssistantQueryState, businessId: string, limit: number): Promise<AssistantKindResult> {
    const terms = state.itemTerms;
    const itemMatch = terms.length > 0 ? itemTermsWhere(terms, ["description", "normalizedName"] as const) : null;

    const where: Prisma.TenderWhereInput = {
      businessId,
      ...(state.statuses.length > 0 ? { status: { in: state.statuses as TenderStatus[] } } : {}),
      ...(state.partyText
        ? { OR: [{ client: { name: contains(state.partyText) } }, { department: contains(state.partyText) }] }
        : {}),
      ...(itemMatch ? { boqs: { some: { isCurrent: true, businessId, items: { some: itemMatch } } } } : {}),
      ...(state.dateField === "created" && state.dateRange ? { createdAt: rangeWhere(state.dateRange) } : {}),
      ...(state.dateField === "deadline"
        ? { submissionDate: state.dateRange ? rangeWhere(state.dateRange) : { not: null } }
        : {}),
    };

    const select = {
      id: true,
      tenderNumber: true,
      title: true,
      status: true,
      createdAt: true,
      submissionDate: true,
      client: { select: { name: true } },
      ...(itemMatch
        ? {
            boqs: {
              where: { isCurrent: true },
              select: { items: { where: itemMatch, take: 1, select: { description: true } } },
            },
          }
        : {}),
    } satisfies Prisma.TenderSelect;

    // `boqs` is only selected when there are item terms, which Prisma's payload typing cannot
    // express for a conditionally-spread select, so the row shape is spelled out.
    interface TenderRow {
      id: string;
      tenderNumber: string;
      title: string;
      status: string;
      createdAt: Date;
      submissionDate: Date | null;
      client: { name: string };
      boqs?: Array<{ items: Array<{ description: string }> }>;
    }
    const toHit = (t: TenderRow, dateLabel: string, date: Date | null): AssistantHit => ({
      type: "Tender",
      id: t.id,
      title: t.title,
      reference: t.tenderNumber,
      status: t.status,
      dateLabel,
      date,
      party: t.client.name,
      matchedItem: t.boqs?.flatMap((b) => b.items)[0]?.description ?? null,
    });

    if (state.dateField === "quoted") {
      // ponytail: candidate set is loaded then narrowed in memory because "quoted at" lives in
      // AuditLog/Attachment, not on the tender. Fine for one business's tender count; if this
      // ever gets slow, denormalise a quotedAt column on Tender.
      const candidates = (await this.prisma.tender.findMany({ where, select })) as unknown as TenderRow[];
      const quotedAt = await this.quotedAtByTender(candidates.map((t) => t.id));
      const range = state.dateRange;
      const hits = candidates
        .flatMap((t) => {
          const at = quotedAt.get(t.id);
          if (!at) return [];
          if (range && (at < new Date(range.from) || at >= new Date(range.to))) return [];
          return [{ hit: toHit(t, "Quoted", at), at }];
        })
        .sort((a, b) => b.at.getTime() - a.at.getTime());
      return { total: hits.length, hits: hits.slice(0, limit).map((h) => h.hit) };
    }

    const [total, found] = await Promise.all([
      this.prisma.tender.count({ where }),
      this.prisma.tender.findMany({ where, select, orderBy: { createdAt: "desc" }, take: limit }),
    ]);
    const rows = found as unknown as TenderRow[];
    const isDeadline = state.dateField === "deadline";
    return {
      total,
      hits: rows.map((t) => toHit(t, isDeadline ? "Due" : "Created", isDeadline ? t.submissionDate : t.createdAt)),
    };
  }

  /**
   * When a quotation went out, per tender: the earliest of (tender moved to SUBMITTED, a QUOTATION
   * document was generated). Both are needed — budgetary quotations may never reach SUBMITTED, and
   * a submitted tender may have had its document made outside the app.
   */
  private async quotedAtByTender(tenderIds: string[]): Promise<Map<string, Date>> {
    const earliest = new Map<string, Date>();
    const note = (id: string | null, at: Date | null) => {
      if (!id || !at) return;
      const prev = earliest.get(id);
      if (!prev || at < prev) earliest.set(id, at);
    };
    for (let i = 0; i < tenderIds.length; i += CHUNK) {
      const ids = tenderIds.slice(i, i + CHUNK);
      const [submitted, quotations] = await Promise.all([
        this.prisma.auditLog.groupBy({
          by: ["entityId"],
          where: {
            entityType: "Tender",
            action: "TENDER_STATUS_CHANGED",
            entityId: { in: ids },
            metadata: { path: ["to"], equals: "SUBMITTED" },
          },
          _min: { createdAt: true },
        }),
        this.prisma.attachment.groupBy({
          by: ["entityId"],
          where: { entityType: "Tender", documentType: "QUOTATION", entityId: { in: ids } },
          _min: { createdAt: true },
        }),
      ]);
      submitted.forEach((r) => note(r.entityId, r._min.createdAt));
      quotations.forEach((r) => note(r.entityId, r._min.createdAt));
    }
    return earliest;
  }

  // ---------- RFQs ----------

  async findRfqs(state: AssistantQueryState, businessId: string, limit: number): Promise<AssistantKindResult> {
    const itemMatch = state.itemTerms.length > 0 ? itemTermsWhere(state.itemTerms, ["description"] as const) : null;
    const deadline = otherKindsDateField(state) === "deadline";
    const where: Prisma.RfqWhereInput = {
      businessId,
      ...(state.statuses.length > 0 ? { status: { in: state.statuses as RfqStatus[] } } : {}),
      ...(state.partyText ? { vendorInvites: { some: { vendor: { name: contains(state.partyText) } } } } : {}),
      ...(itemMatch ? { items: { some: itemMatch } } : {}),
      ...(deadline
        ? { dueDate: state.dateRange ? rangeWhere(state.dateRange) : { not: null } }
        : state.dateRange
          ? { createdAt: rangeWhere(state.dateRange) }
          : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.rfq.count({ where }),
      this.prisma.rfq.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          dueDate: true,
          tender: { select: { tenderNumber: true } },
          ...(itemMatch ? { items: { where: itemMatch, take: 1, select: { description: true } } } : {}),
        },
      }),
    ]);
    return {
      total,
      hits: rows.map((r) => ({
        type: "Rfq" as const,
        id: r.id,
        title: r.title,
        reference: r.tender?.tenderNumber ?? null,
        status: r.status,
        dateLabel: deadline ? "Due" : "Created",
        date: deadline ? r.dueDate : r.createdAt,
        party: null,
        matchedItem: r.items?.[0]?.description ?? null,
      })),
    };
  }

  // ---------- purchase orders ----------

  async findPurchaseOrders(state: AssistantQueryState, businessId: string, limit: number): Promise<AssistantKindResult> {
    const itemMatch = state.itemTerms.length > 0 ? itemTermsWhere(state.itemTerms, ["description"] as const) : null;
    const deadline = otherKindsDateField(state) === "deadline";
    const where: Prisma.PurchaseOrderWhereInput = {
      businessId,
      ...(state.statuses.length > 0 ? { status: { in: state.statuses as PurchaseOrderStatus[] } } : {}),
      ...(state.partyText ? { vendor: { name: contains(state.partyText) } } : {}),
      ...(itemMatch ? { items: { some: itemMatch } } : {}),
      ...(deadline
        ? { expectedDeliveryDate: state.dateRange ? rangeWhere(state.dateRange) : { not: null } }
        : state.dateRange
          ? { createdAt: rangeWhere(state.dateRange) }
          : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          poNumber: true,
          status: true,
          createdAt: true,
          expectedDeliveryDate: true,
          vendor: { select: { name: true } },
          ...(itemMatch ? { items: { where: itemMatch, take: 1, select: { description: true } } } : {}),
        },
      }),
    ]);
    return {
      total,
      hits: rows.map((p) => ({
        type: "PurchaseOrder" as const,
        id: p.id,
        title: `${p.poNumber} — ${p.vendor.name}`,
        reference: p.poNumber,
        status: p.status,
        dateLabel: deadline ? "Delivery due" : "Created",
        date: deadline ? p.expectedDeliveryDate : p.createdAt,
        party: p.vendor.name,
        matchedItem: p.items?.[0]?.description ?? null,
      })),
    };
  }

  // ---------- bills ----------

  async findBills(state: AssistantQueryState, businessId: string, limit: number): Promise<AssistantKindResult> {
    const itemMatch = state.itemTerms.length > 0 ? itemTermsWhere(state.itemTerms, ["description"] as const) : null;
    // Bills have no status and no deadline; both filters are ignored rather than emptying the result.
    const where: Prisma.BillWhereInput = {
      businessId,
      ...(state.partyText ? { tender: { client: { name: contains(state.partyText) } } } : {}),
      ...(itemMatch ? { items: { some: itemMatch } } : {}),
      ...(state.dateRange ? { billDate: rangeWhere(state.dateRange) } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.bill.count({ where }),
      this.prisma.bill.findMany({
        where,
        orderBy: { billDate: "desc" },
        take: limit,
        select: {
          id: true,
          billNumber: true,
          billDate: true,
          tender: { select: { tenderNumber: true, title: true, client: { select: { name: true } } } },
          ...(itemMatch ? { items: { where: itemMatch, take: 1, select: { description: true } } } : {}),
        },
      }),
    ]);
    return {
      total,
      hits: rows.map((b) => ({
        type: "Bill" as const,
        id: b.id,
        title: `Bill ${b.billNumber} — ${b.tender.title}`,
        reference: b.tender.tenderNumber,
        status: null,
        dateLabel: "Billed",
        date: b.billDate,
        party: b.tender.client.name,
        matchedItem: b.items?.[0]?.description ?? null,
      })),
    };
  }
}
