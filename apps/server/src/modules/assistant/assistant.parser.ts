import type { AssistantDateField, AssistantEntity } from "@bmp/types";

import { resolveDatePhrase, type ResolvedDate } from "./assistant.dates.js";

/**
 * Deterministic half of message understanding: everything with a closed vocabulary (document
 * kind, status, which date, the time phrase, follow-up wording). Benchmarked against the local
 * models, these are exactly the parts small LLMs get wrong — inventing statuses, and dropping
 * still-valid filters when asked to patch a previous query — so none of it is left to the model.
 * The LLM only extracts the open-vocabulary parts (item names, party name); see assistant.terms.ts.
 */

export interface FollowUpCues {
  /** Message reads as a continuation ("the ones I won", "and for cables?"). */
  refine: boolean;
  /** New values add to the previous ones instead of replacing them ("also gaskets"). */
  add: boolean;
  clearStatuses: boolean;
  clearDate: boolean;
  clearItems: boolean;
  clearParty: boolean;
}

export interface ParsedMessage {
  entity: AssistantEntity | null;
  /** The message actually named a document kind (as opposed to one inferred from a status word). */
  entityExplicit: boolean;
  /** Several kinds were listed ("POs, RFQs and bills"), meaning: search all of them. */
  allKinds: boolean;
  statuses: string[];
  /** Explicit date wording (quoted / deadline / created), or null when the message does not say. */
  dateField: AssistantDateField | null;
  date: ResolvedDate | null;
  cues: FollowUpCues;
  /** Looks like a document number (e.g. TND-2026-001) — those go through plain document search. */
  documentNumber: boolean;
  /** The message with every recognised phrase blanked out; input for the heuristic term fallback. */
  residual: string;
  /** A "remove/any/all …" instruction to drop an existing filter was recognised. */
  clears: boolean;
  /** Anything structured was recognised, so this is a filter request rather than free text. */
  hasSignal: boolean;
}

const ENTITY_WORDS: Array<[AssistantEntity, RegExp]> = [
  ["tender", /\btenders?\b/gi],
  ["rfq", /\b(?:rfqs?|requests?\s+for\s+quot(?:ation|e)s?)\b/gi],
  ["purchase_order", /\b(?:pos?|purchase\s+orders?)\b/gi],
  ["bill", /\bbills?\b/gi],
];

const STATUS_WORDS: Array<{ re: RegExp; value: string; hint: AssistantEntity | null }> = [
  { re: /\b(?:partially|partly)\s+received\b/gi, value: "PARTIALLY_RECEIVED", hint: "purchase_order" },
  { re: /\b(?:won|win|wins|winning|awarded)\b/gi, value: "WON", hint: "tender" },
  { re: /\blost\b/gi, value: "LOST", hint: "tender" },
  { re: /\bcancell?ed\b/gi, value: "CANCELLED", hint: null },
  { re: /\bdrafts?\b/gi, value: "DRAFT", hint: null },
  { re: /\b(?:sent|dispatched)\b/gi, value: "SENT", hint: "rfq" },
  { re: /\bclosed\b/gi, value: "CLOSED", hint: "rfq" },
  { re: /\bissued\b/gi, value: "ISSUED", hint: "purchase_order" },
  { re: /\b(?:received|delivered)\b/gi, value: "RECEIVED", hint: "purchase_order" },
];

// "Quoted" = a quotation went out for the tender. A bare "quote"/"quotes" is deliberately not a cue
// (for RFQs it means vendor quotes, not ours) — only our own act of quoting: "we quote", "I quoted".
const QUOTED_CUE = /\b(?:quoted|quotations?|submitted|(?:we|i)\s+quote|bid(?:ded)?\s+(?:on|for)|we\s+bid)\b/gi;
const DEADLINE_CUE = /\b(?:due|deadline|closing|closes|expir(?:ing|es)|submission\s+date)\b/gi;
const CREATED_CUE = /\b(?:created|added|raised|entered)\b/gi;

const DROP = "(?:remove|drop|ignore|without|clear|reset|forget)";
const CLEAR_CUES: Array<[keyof FollowUpCues, RegExp[]]> = [
  [
    "clearStatuses",
    [
      new RegExp(`\\b${DROP}\\s+(?:the\\s+)?(?:won|lost|status|draft|cancell?ed|sent|closed|issued|received)\\b(?:\\s+(?:filter|ones|only))?`, "gi"),
      /\b(?:any|all)\s+status(?:es)?\b/gi,
      /\bregardless\s+of\s+(?:the\s+)?status\b/gi,
    ],
  ],
  [
    "clearDate",
    [
      new RegExp(`\\b${DROP}\\s+(?:the\\s+)?(?:date|time|period|month|year)(?:\\s+filter)?\\b`, "gi"),
      /\b(?:any|all)\s*(?:time|dates?)\b/gi,
    ],
  ],
  [
    "clearItems",
    [
      new RegExp(`\\b${DROP}\\s+(?:the\\s+)?(?:item|product|material)s?(?:\\s+filter)?\\b`, "gi"),
      /\b(?:any|all)\s+items?\b/gi,
    ],
  ],
  [
    "clearParty",
    [
      new RegExp(`\\b${DROP}\\s+(?:the\\s+)?(?:client|customer|vendor|supplier|party)(?:\\s+filter)?\\b`, "gi"),
      /\b(?:any|all)\s+(?:client|customer|vendor|supplier)s?\b/gi,
    ],
  ],
];

const REFINE_CUE =
  /^\s*(?:and|also|now|then|but|only|just|what\s+about|how\s+about|instead)\b|\b(?:the\s+ones|those|them|these|of\s+them|among\s+(?:them|those)|same\s+ones?)\b/i;
const ADD_CUE = /\b(?:also|as\s+well|too|in\s+addition|along\s+with|plus)\b|^\s*and\b/i;

/** Blanks matches with spaces (keeps indexes stable) and reports whether anything matched. */
function consume(text: string, re: RegExp): { text: string; matches: string[] } {
  const matches: string[] = [];
  const next = text.replace(re, (m) => {
    matches.push(m);
    return " ".repeat(m.length);
  });
  return { text: next, matches };
}

/** Blanks the first occurrence of `phrase` (case-insensitive) without regex-escaping concerns. */
function blankFirst(text: string, phrase: string): string {
  const at = text.toLowerCase().indexOf(phrase.toLowerCase());
  return at === -1 ? text : text.slice(0, at) + " ".repeat(phrase.length) + text.slice(at + phrase.length);
}

function looksLikeDocumentNumber(message: string): boolean {
  const tokens = message.match(/\b[A-Za-z]{2,6}[-/][A-Za-z0-9/-]*\d[A-Za-z0-9/-]*/g) ?? [];
  // >= 4 digits keeps material grades like "SS-304" out; TND-2041 / TND-2026-001 stay in.
  return tokens.some((t) => (t.match(/\d/g) ?? []).length >= 4);
}

export function parseMessage(message: string, now: Date, tz: string): ParsedMessage {
  let text = message;

  const cues: FollowUpCues = {
    refine: REFINE_CUE.test(message),
    add: ADD_CUE.test(message),
    clearStatuses: false,
    clearDate: false,
    clearItems: false,
    clearParty: false,
  };
  // Clear cues go first and are blanked, so "remove the won filter" does not also add WON.
  for (const [key, patterns] of CLEAR_CUES) {
    for (const re of patterns) {
      const r = consume(text, re);
      if (r.matches.length > 0) {
        cues[key] = true;
        text = r.text;
      }
    }
  }

  const deadline = consume(text, DEADLINE_CUE);
  text = deadline.text;
  const date = resolveDatePhrase(text, now, tz, { allowFuture: deadline.matches.length > 0 });
  if (date) text = blankFirst(text, date.matched);

  // Entity: the first document-kind word wins — unless several are listed ("POs, RFQs and bills"),
  // which means all of them.
  const mentions: Array<{ kind: AssistantEntity; at: number; end: number }> = [];
  for (const [kind, re] of ENTITY_WORDS) {
    for (const m of text.matchAll(new RegExp(re.source, "gi"))) {
      mentions.push({ kind, at: m.index, end: m.index + m[0].length });
    }
    text = consume(text, re).text;
  }
  mentions.sort((a, b) => a.at - b.at);
  const isList =
    new Set(mentions.map((m) => m.kind)).size > 1 &&
    mentions.every((m, i) => i === 0 || /^\s*(?:,|&|\/|and|or|,\s*and|,\s*or)?\s*$/i.test(message.slice(mentions[i - 1]!.end, m.at)));
  const allKinds = isList;
  let entity: AssistantEntity | null = allKinds ? null : (mentions[0]?.kind ?? null);

  const quoted = consume(text, QUOTED_CUE);
  text = quoted.text;
  const created = consume(text, CREATED_CUE);
  text = created.text;
  const dateField: AssistantDateField | null =
    deadline.matches.length > 0 ? "deadline" : quoted.matches.length > 0 ? "quoted" : created.matches.length > 0 ? "created" : null;

  const statuses: string[] = [];
  let hint: AssistantEntity | null = null;
  for (const status of STATUS_WORDS) {
    const r = consume(text, status.re);
    if (r.matches.length > 0) {
      statuses.push(status.value);
      hint ??= status.hint;
      text = r.text;
    }
  }
  const entityExplicit = entity !== null || allKinds;
  if (!allKinds) entity ??= hint;

  const clears = cues.clearStatuses || cues.clearDate || cues.clearItems || cues.clearParty;
  return {
    entity,
    entityExplicit,
    allKinds,
    statuses: [...new Set(statuses)],
    dateField,
    date,
    cues,
    documentNumber: looksLikeDocumentNumber(message),
    residual: text.replace(/\s+/g, " ").trim(),
    clears,
    hasSignal: Boolean(entity || statuses.length > 0 || date || dateField || clears),
  };
}
