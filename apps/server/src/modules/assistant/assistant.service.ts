import type { AssistantQueryResultDto } from "@bmp/types";

import { ServiceUnavailableError } from "../../core/errors/HttpErrors.js";
import { generateJson, generateText } from "../../infra/llm/ollama.client.js";
import type { ReportsService } from "../reports/reports.service.js";

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

/** Retrieval-only: this never invents a document — it only paraphrases what search actually found. */
export class AssistantService {
  constructor(private readonly reportsService: Pick<ReportsService, "search">) {}

  async query(message: string, businessId: string): Promise<AssistantQueryResultDto> {
    let searchQuery = message;
    try {
      const raw = await generateJson(buildIntentPrompt(message));
      const intent = parseIntent(raw);
      if (intent) {
        searchQuery = [intent.tenderNumber, intent.documentType, intent.freeTextQuery]
          .filter((part): part is string => Boolean(part))
          .join(" ");
      }
    } catch (err) {
      if (!(err instanceof ServiceUnavailableError)) throw err;
      // Ollama down: fall back to searching on the raw message, same degrade-gracefully
      // philosophy as document indexing and content search.
    }

    const searchResult = await this.reportsService.search(businessId, searchQuery);
    if (searchResult.results.length === 0) {
      return { reply: "Nothing found matching that.", results: [] };
    }

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
      return { reply, results: searchResult.results };
    } catch (err) {
      if (!(err instanceof ServiceUnavailableError)) throw err;
      return {
        reply: `Found ${searchResult.results.length} result(s) for "${message}".`,
        results: searchResult.results,
      };
    }
  }
}
