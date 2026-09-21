import {
  ASSISTANT_ENTITIES,
  type AssistantEntity,
  type AssistantQueryInput,
  type AssistantQueryResultDto,
  type AssistantQueryState,
} from "@bmp/types";

import { env } from "../../config/env.js";
import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";
import { generateJson, generateText } from "../../infra/llm/ollama.client.js";
import type { ReportsService } from "../reports/reports.service.js";

import { mergeState, removeFilter } from "./assistant.merge.js";
import { parseMessage } from "./assistant.parser.js";
import { buildChips, buildReply, hitToResult } from "./assistant.presenter.js";
import { ENTITY_LABELS, ENTITY_PERMISSION, ENTITY_STATUSES, normalizeState } from "./assistant.query.js";
import type { AssistantHit, AssistantKindResult, IAssistantRepository } from "./assistant.repository.js";
import { extractTerms, hasContentWords } from "./assistant.terms.js";

export interface AssistantCaller {
  roleId: string;
  businessId: string;
}

export interface AssistantServiceOptions {
  now?: () => Date;
  timezone?: string;
  extract?: typeof extractTerms;
}

/** Rows shown when one document kind is asked for / when results from all kinds are mixed. */
const SINGLE_KIND_LIMIT = 25;
const MIXED_KINDS_LIMIT = 10;

/**
 * Retrieval-only assistant: it never invents a document. A message is read into a structured
 * query (deterministic parsing for kind/status/date/follow-up wording, a small LLM only for item
 * and party names), merged onto the previous turn's query, and executed as plain business-scoped
 * Prisma reads. Messages with nothing to filter on ("find the bill for TND-2026-001", a bare
 * client name) still go through the original document search.
 */
export class AssistantService {
  private readonly now: () => Date;
  private readonly timezone: string;
  private readonly extract: typeof extractTerms;

  constructor(
    private readonly reportsService: Pick<ReportsService, "search">,
    private readonly repository: IAssistantRepository,
    private readonly hasPermission: (roleId: string, permissionKey: string) => Promise<boolean>,
    options: AssistantServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.timezone = options.timezone ?? env.ASSISTANT_TIMEZONE;
    this.extract = options.extract ?? extractTerms;
  }

  async query(input: AssistantQueryInput, caller: AssistantCaller): Promise<AssistantQueryResultDto> {
    const prior = input.state ? normalizeState(input.state) : null;

    // Dismissing a chip: no wording to interpret, just re-run without that filter.
    if (input.message === undefined) {
      if (!prior || !input.removeFilter) return this.legacySearch("", caller.businessId);
      return this.run(removeFilter(prior, input.removeFilter), caller);
    }

    const message = input.message.trim();
    const parsed = parseMessage(message, this.now(), this.timezone);

    // A document number is a lookup, not a filter query.
    if (parsed.documentNumber && !parsed.date && parsed.statuses.length === 0) {
      return this.legacySearch(message, caller.businessId);
    }

    const terms = hasContentWords(parsed.residual)
      ? await this.extract(message, parsed.residual)
      : { itemTerms: [], partyText: null };

    const structured = parsed.hasSignal || terms.itemTerms.length > 0 || (prior !== null && terms.partyText !== null);
    if (!structured) return this.legacySearch(message, caller.businessId);

    // Only a document kind was recognised ("find the bill for tender 1400014205") yet words are
    // left over that no filter accounts for: listing every document of that kind would be a wrong
    // answer, so treat it as a lookup instead.
    const onlyKindNamed =
      parsed.entity !== null &&
      parsed.statuses.length === 0 &&
      !parsed.date &&
      !parsed.dateField &&
      terms.itemTerms.length === 0 &&
      terms.partyText === null &&
      !parsed.clears;
    if (onlyKindNamed && hasContentWords(parsed.residual)) return this.legacySearch(message, caller.businessId);

    const state = mergeState({ prior, parsed, itemTerms: terms.itemTerms, partyText: terms.partyText });
    const result = await this.run(state, caller);

    // A bare item-looking phrase with no filter words might really be a tender/document title
    // ("Switchgear installation"): if it matched nothing as items, try the plain document search.
    if (!parsed.hasSignal && prior === null && result.total === 0) {
      const legacy = await this.legacySearch(message, caller.businessId);
      if (legacy.results.length > 0) return legacy;
    }
    return result;
  }

  // ---------- structured path ----------

  private async run(state: AssistantQueryState, caller: AssistantCaller): Promise<AssistantQueryResultDto> {
    const kinds: AssistantEntity[] = state.entity ? [state.entity] : [...ASSISTANT_ENTITIES];
    const permitted = await Promise.all(kinds.map((k) => this.hasPermission(caller.roleId, ENTITY_PERMISSION[k])));
    const allowed = kinds.filter((_, i) => permitted[i]);
    const skipped = kinds.filter((_, i) => !permitted[i]).map((k) => ENTITY_LABELS[k].plural);
    const limit = state.entity ? SINGLE_KIND_LIMIT : MIXED_KINDS_LIMIT;

    const plan = allowed.flatMap((kind) => {
      const statuses = state.statuses.filter((s) => ENTITY_STATUSES[kind].includes(s));
      // A status this kind can never have ("won" RFQs) means it has no matches, not "ignore the filter".
      if (state.statuses.length > 0 && statuses.length === 0) return [];
      return [{ kind, kindState: { ...state, statuses } }];
    });
    const results = await Promise.all(
      plan.map((p) => this.runKind(p.kind, p.kindState, caller.businessId, limit)),
    );
    const kindCounts = plan.map((p, i) => ({ type: TYPE_OF[p.kind], total: results[i]?.total ?? 0 }));
    const hits: AssistantHit[] = results.flatMap((r) => r.hits);

    return {
      reply: buildReply(state, kindCounts, hits.length, skipped),
      results: hits.map((h) => hitToResult(h, this.timezone)),
      total: kindCounts.reduce((sum, c) => sum + c.total, 0),
      filters: buildChips(state),
      state,
    };
  }

  private runKind(
    kind: AssistantEntity,
    state: AssistantQueryState,
    businessId: string,
    limit: number,
  ): Promise<AssistantKindResult> {
    switch (kind) {
      case "tender":
        return this.repository.findTenders(state, businessId, limit);
      case "rfq":
        return this.repository.findRfqs(state, businessId, limit);
      case "purchase_order":
        return this.repository.findPurchaseOrders(state, businessId, limit);
      case "bill":
        return this.repository.findBills(state, businessId, limit);
    }
  }

  // ---------- original document search (nothing structured to filter on) ----------

  private async legacySearch(message: string, businessId: string): Promise<AssistantQueryResultDto> {
    const nothing = (reply: string): AssistantQueryResultDto => ({
      reply,
      results: [],
      total: 0,
      filters: [],
      state: null,
    });
    if (!message) return nothing("Nothing found matching that.");

    let searchQuery = message;
    try {
      const raw = await generateJson(buildIntentPrompt(message));
      const intent = parseIntent(raw);
      if (intent) searchQuery = intent.tenderNumber ?? intent.freeTextQuery;
    } catch (err) {
      if (!(err instanceof ServiceUnavailableError)) throw err;
      // Ollama down: fall back to searching on the raw message.
    }

    const searchResult = await this.reportsService.search(businessId, searchQuery);
    if (searchResult.results.length === 0) return nothing("Nothing found matching that.");

    const base = { results: searchResult.results, total: searchResult.results.length, filters: [], state: null };
    try {
      const reply = await generateText(
        [
          `The user asked: "${message}"`,
          "Search found these results:",
          ...searchResult.results.map((r) => `- ${r.title}${r.subtitle ? ` (${r.subtitle})` : ""}`),
          "",
          "Reply in one short sentence confirming what was found. Do not invent anything not listed above.",
        ].join("\n"),
      );
      return { ...base, reply };
    } catch (err) {
      if (!(err instanceof ServiceUnavailableError)) throw err;
      return { ...base, reply: `Found ${searchResult.results.length} result(s) for "${message}".` };
    }
  }
}

const TYPE_OF = {
  tender: "Tender",
  rfq: "Rfq",
  purchase_order: "PurchaseOrder",
  bill: "Bill",
} as const;

// ---------- original intent extraction, kept for the document-search path ----------

interface AssistantIntent {
  tenderNumber: string | null;
  documentType: string | null;
  freeTextQuery: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseIntent(raw: unknown): AssistantIntent | null {
  if (!isRecord(raw)) return null;
  const freeTextQuery = typeof raw.freeTextQuery === "string" ? raw.freeTextQuery.trim() : "";
  if (!freeTextQuery) return null;
  const tenderNumber =
    typeof raw.tenderNumber === "string" && raw.tenderNumber.trim() ? raw.tenderNumber.trim() : null;
  const documentType =
    typeof raw.documentType === "string" && raw.documentType.trim() ? raw.documentType.trim() : null;
  return { tenderNumber, documentType, freeTextQuery };
}

function buildIntentPrompt(message: string): string {
  return [
    "Extract search hints from this request for a construction-tender document search system.",
    "",
    `Request: "${message}"`,
    "",
    "Return JSON only, with exactly these keys:",
    '  "tenderNumber": the tender number mentioned, exactly as written, or null if none',
    '  "documentType": one word for the kind of document if mentioned (e.g. "bill", "undertaking", "drawing"), or null',
    '  "freeTextQuery": the request rewritten as a short plain search query (2-6 words)',
  ].join("\n");
}
