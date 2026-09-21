import { z } from "zod";

import { env } from "../../config/env.js";
import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";
import { generateJson, type GenerateJsonOptions } from "../../infra/llm/ollama.client.js";

/**
 * Open-vocabulary extraction: which items and which client/vendor the user is talking about.
 * This is the one job given to the local LLM — narrow, schema-constrained, and cheap to check —
 * with a rule-based fallback so the assistant still works when Ollama is down or slow.
 */

export interface ExtractedTerms {
  itemTerms: string[];
  partyText: string | null;
  source: "llm" | "heuristic";
}

const MAX_TERMS = 6;
const MAX_TERM_LENGTH = 60;
/** A hung model must not hang the chat; on timeout we fall back to the heuristic. */
export const TERMS_TIMEOUT_MS = 15_000;

/**
 * Plural -> singular for one word, so "washers" also finds "Flat Washer M8" (matching is a
 * substring search, so the singular stem covers both). Conservative on purpose: short words and
 * -ss/-us/-is endings ("brass", "bus", "analysis") are left alone.
 */
export function singularize(word: string): string {
  const lower = word.toLowerCase();
  if (word.length < 4 || /(?:ss|us|is)$/.test(lower)) return word;
  if (/ies$/.test(lower)) return `${word.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|zes|sses)$/.test(lower)) return word.slice(0, -2);
  if (lower.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** Singularizes every word of a phrase ("stainless steel 304 pipes" -> "stainless steel 304 pipe"). */
export function normalizeTerm(term: string): string {
  return term
    .replace(/[^\p{L}\p{N}\s./"'×x-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(singularize)
    .join(" ")
    .trim();
}

const STOPWORDS = new Set([
  "tender", "tenders", "rfq", "rfqs", "bill", "bills", "po", "pos", "order", "orders", "purchase", "quotation",
  "quotations", "quoted", "won", "lost", "sent", "closed", "issued", "received", "draft", "cancelled",
  "canceled", "last", "this", "month", "year", "week", "quarter", "today", "yesterday", "the", "a", "an", "all",
  "any", "ones", "one", "those", "them", "me", "i", "we", "our", "my", "which", "what", "show", "list", "find",
  "give", "get", "documents", "document", "items", "item", "things", "everything",
]);

/** Drops empties, filler words the model echoed back, duplicates, and anything oversized. */
function cleanTerms(raw: string[], message: string): string[] {
  const lowerMessage = message.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of raw) {
    const term = normalizeTerm(candidate);
    if (!term || term.length > MAX_TERM_LENGTH) continue;
    const tokens = term.toLowerCase().split(" ");
    if (tokens.every((t) => STOPWORDS.has(t) || STOPWORDS.has(singularize(t)))) continue;
    // Hallucination guard: every word must actually appear in what the user typed.
    if (!tokens.every((t) => lowerMessage.includes(t))) continue;
    if (seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(term);
    if (out.length === MAX_TERMS) break;
  }
  return out;
}

const FILLER = new Set([
  "show", "me", "which", "the", "ones", "one", "those", "them", "these", "i", "we", "what", "about", "how", "and",
  "also", "only", "just", "now", "then", "please", "list", "find", "give", "all", "any", "of", "for", "in", "on",
  "at", "to", "by", "from", "my", "our", "us", "it", "that", "did", "do", "does", "are", "is", "was", "were",
  "have", "has", "had", "can", "you", "could", "would", "if", "so", "but", "or", "a", "an", "with", "get", "same",
]);

/**
 * Whether anything is left after the recognised filter words and filler — used to skip the LLM
 * entirely for messages like "the ones which I won", which name no item or party.
 */
export function hasContentWords(residual: string): boolean {
  return residual
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => word.length > 0 && !FILLER.has(word));
}

const cleanParty = (party: string | null | undefined, message: string): string | null => {
  const p = party?.trim();
  return p && p.length <= 80 && message.toLowerCase().includes(p.toLowerCase()) ? p : null;
};

// ---------- LLM path ----------

const TERMS_SCHEMA = {
  type: "object",
  properties: {
    itemTerms: { type: "array", items: { type: "string" } },
    partyText: { type: ["string", "null"] },
  },
  required: ["itemTerms", "partyText"],
} as const;

const llmOutputSchema = z.object({
  itemTerms: z.array(z.string()),
  partyText: z.string().nullable(),
});

const PROMPT_HEAD = `Extract two things from a request to a construction-tender ERP search assistant.
itemTerms: the products, materials or parts the user wants documents to contain (e.g. "washer", "PVC conduit 25mm"). Singular form. Empty list if none is named.
partyText: the client, department or vendor company name if one is named, else null.
Ignore words about document kind (tender, rfq, bill, PO), status (won, lost, quoted), time (last month, this year) and filler words.
Examples:
"show me which tenders I quoted last month for washers" -> {"itemTerms":["washer"],"partyText":null}
"the ones which I won" -> {"itemTerms":[],"partyText":null}
"lost ones from Meridian Power in the last 3 months" -> {"itemTerms":[],"partyText":"Meridian Power"}
"RFQs with M8 hex bolts and gaskets this year" -> {"itemTerms":["M8 hex bolt","gasket"],"partyText":null}
"bills for cable glands sent to Apex Electricals" -> {"itemTerms":["cable gland"],"partyText":"Apex Electricals"}`;

type JsonGenerator = (prompt: string, model?: string, options?: GenerateJsonOptions) => Promise<unknown>;

export async function extractTerms(
  message: string,
  residual: string,
  generate: JsonGenerator = generateJson,
): Promise<ExtractedTerms> {
  try {
    const raw = await generate(`${PROMPT_HEAD}\n\nRequest: ${JSON.stringify(message)}`, env.OLLAMA_MODEL, {
      schema: TERMS_SCHEMA as unknown as Record<string, unknown>,
      timeoutMs: TERMS_TIMEOUT_MS,
      temperature: 0,
    });
    const parsed = llmOutputSchema.safeParse(raw);
    if (parsed.success) {
      return {
        itemTerms: cleanTerms(parsed.data.itemTerms, message),
        partyText: cleanParty(parsed.data.partyText, message),
        source: "llm",
      };
    }
  } catch (err) {
    if (!(err instanceof ServiceUnavailableError)) throw err;
    // Ollama down / timed out: same degrade-gracefully policy as the rest of the app's AI features.
  }
  return { ...heuristicTerms(residual, message), source: "heuristic" };
}

// ---------- rule-based fallback ----------

const CLAUSE_MARKER = /\b(?:for|of|with|containing|contain|having|including|regarding|about|on)\s+(.+)$/i;
const PARTY_MARKER = /\b(?:from|by|to|for\s+client|for\s+vendor)\s+((?:[A-Z][\w&.'-]*)(?:\s+[A-Z][\w&.'-]*)*)/;

/**
 * No LLM: pull item words from the clause after "for/of/with/containing…" and a party from a
 * capitalised phrase after "from/by/to". Deliberately conservative — an empty result just means
 * "no item filter", which is safer than a wrong one.
 */
export function heuristicTerms(residual: string, message: string): Omit<ExtractedTerms, "source"> {
  const partyMatch = PARTY_MARKER.exec(message);
  const partyText = cleanParty(partyMatch?.[1], message);

  let clause = CLAUSE_MARKER.exec(residual)?.[1] ?? "";
  if (partyMatch?.[1]) clause = clause.replace(partyMatch[1], " ");
  clause = clause.replace(/\b(?:from|by|to)\b/gi, " ");
  const pieces = clause
    .split(/\b(?:and|or)\b|[,;]/i)
    .map((piece) => piece.replace(/\b(?:the|a|an|any|all|some|of|for|with|in|on|at)\b/gi, " ").replace(/[?!.]+$/g, "").trim())
    .filter(Boolean);
  return { itemTerms: cleanTerms(pieces, message), partyText };
}
