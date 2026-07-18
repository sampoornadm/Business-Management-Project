import type { TenderExtractionFields, TenderExtractionResultDto } from "@bmp/types";
import { z } from "zod";

import { env } from "../../config/env.js";
import type { IOrganizationsRepository } from "../organizations/organizations.repository.js";

import { parseIiscoHeaderFields } from "./tender-header.parser.js";
import { parseIiscoRfqItems } from "./tender-item.parser.js";
import { parseTenderNotes } from "./tender-notes.parser.js";

export type GenerateJsonFn = (prompt: string) => Promise<unknown>;
export type GenerateTextFn = (prompt: string) => Promise<string>;
export type ExtractTextFn = (buffer: Buffer, mimeType: string) => Promise<string>;

// Keeps local-LLM inference fast and within context — a tender/NIT's header
// fields (number, dates, amounts, department) are always on the first pages;
// this comfortably covers a multi-page cover section without the item table
// bloating the prompt. Applied only to what's sent to the model — the
// deterministic item parser below runs against the full, untruncated text.
const MAX_PROMPT_CHARS = 12_000;

const extractionSchema = z.object({
  tenderNumber: z.string().nullish(),
  title: z.string().nullish(),
  department: z.string().nullish(),
  type: z.string().nullish(),
  category: z.string().nullish(),
  location: z.string().nullish(),
  state: z.string().nullish(),
  estimatedCost: z.coerce.number().nullish(),
  emdAmount: z.coerce.number().nullish(),
  tenderFee: z.coerce.number().nullish(),
  documentFee: z.coerce.number().nullish(),
  submissionDate: z.string().nullish(),
  openingDate: z.string().nullish(),
  validityPeriodDays: z.coerce.number().nullish(),
  description: z.string().nullish(),
  remarks: z.string().nullish(),
  clientName: z.string().nullish(),
});

const FIELD_PROMPT = `You are extracting structured fields from a tender / bid-invitation / NIT document.
Read the document text below and return ONLY a single JSON object (no markdown, no explanation) with exactly these keys:

- tenderNumber: the tender/TE/RFQ reference number
- title: a short human-readable title for what is being procured
- department: the issuing department or contracting agency
- type: the tender/bid type (e.g. "Two Part Bid", "e-Procurement", "Open Tender")
- category: a short procurement category (e.g. "Metal Pipes", "Civil Works")
- location: the delivery/execution location, if stated
- state: the Indian state, if stated
- estimatedCost: total estimated tender value as a plain number, if stated
- emdAmount: earnest money deposit amount as a plain number, if stated
- tenderFee: tender fee amount as a plain number, if stated
- documentFee: document fee amount as a plain number, if stated
- submissionDate: the bid/quotation submission deadline, as an ISO 8601 date (YYYY-MM-DD)
- openingDate: the bid opening date, as an ISO 8601 date (YYYY-MM-DD), if stated
- validityPeriodDays: quotation/offer validity period in days, as a plain integer
- description: a 1-2 sentence description of what is being procured
- remarks: any other short operationally-relevant notes (dealing officer, evaluation criteria) — omit generic legal/boilerplate text
- clientName: the name of the organization issuing the tender

Rules:
- If a field is not present in the text, set it to null. Never guess or invent a value.
- Dates must be ISO 8601 (YYYY-MM-DD) or null.
- Numbers must be plain numbers (no currency symbols/commas) or null.

Document text:
"""
`;

// Notes/terms can sit deeper than the header fields (page 2+), so allow a larger window than
// MAX_PROMPT_CHARS — but still bounded, since the item table (irrelevant here) follows.
const MAX_NOTES_CHARS = 16_000;

// Raw markdown out, not JSON — a big multi-line string wrapped in JSON is needlessly fragile
// (small local models routinely break the escaping). See generateText.
//
// Deliberately strict/verbatim: the model must COPY the document's own notes sections, never
// invent, rename or categorise them. An earlier, looser prompt manufactured "NIT"/"ITT"
// headings that were not in the document — the whole point here is faithful capture, with the
// AI-driven trimming saved for a later, explicit step.
const NOTES_PROMPT = `You copy the notes / terms / instructions text out of a tender document, VERBATIM.

Rules — follow exactly:
- Copy the text word for word. Do NOT paraphrase, summarise, translate, shorten, reword, or fix anything.
- Use ONLY headings that literally appear in the document (e.g. a line like "Note:- Anti-bribery Undertaking:"). Render each such heading as a "## <the heading text>" line.
- Do NOT invent, add, rename, merge, split, reorder, or categorise sections. Never output a heading such as "NIT", "ITT", or "General Terms" unless that exact label appears as a heading in the text.
- Under each heading, put each distinct point on its own line starting with "- ", copied verbatim.
- Exclude only the repeating page furniture: company letterhead, addresses, GST/CIN numbers, page numbers, and the item/BOQ table.
- If the document has no such notes/terms/instructions sections, output nothing at all.

Output ONLY the markdown (no preamble, no explanation, no code fences).

Document text:
"""
`;

/** Models sometimes wrap output in a ```markdown fence despite instructions — strip it. */
function stripCodeFence(text: string): string {
  return text
    .replace(/^\s*```(?:markdown|md)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

/**
 * Tidy the notes markdown: drop empty bullets ("- ") and any "## Header" that has no content
 * before the next header/EOF. The LLM readily emits an empty "## NIT" / "## ITT" section when
 * the document has no such section; this removes that noise from both AI and regex output.
 */
function cleanupNotes(markdown: string): string {
  const lines = markdown.split("\n").filter((line) => {
    const t = line.trim();
    return t !== "-" && t !== "*" && t !== "•";
  });

  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("#")) {
      let hasContent = false;
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j]!.trim();
        if (next.startsWith("#")) break;
        if (next) {
          hasContent = true;
          break;
        }
      }
      if (!hasContent) continue;
    }
    out.push(lines[i]!);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export class TenderExtractionService {
  constructor(
    private readonly organizationsRepository: IOrganizationsRepository,
    private readonly generateJson: GenerateJsonFn,
    private readonly extractText: ExtractTextFn,
    private readonly generateText: GenerateTextFn,
  ) {}

  private async matchClient(
    clientName: string,
  ): Promise<{ suggestedClientId?: string; suggestedClientName: string }> {
    const matches = await this.organizationsRepository.findMany(
      { page: 1, pageSize: 5 },
      { search: clientName },
    );
    return {
      suggestedClientId: matches.items.length === 1 ? matches.items[0]!.id : undefined,
      suggestedClientName: clientName,
    };
  }

  /**
   * Terms & Notes extraction is independent of the header-field path above: header fields for the
   * recognized template are deterministic (and return early), but notes should be captured either
   * way. LLM by default (handles the messy, letterhead-interleaved prose); regex when the flag is
   * off, or as a fallback when the LLM is unavailable/unusable.
   */
  private async extractNotes(text: string, warnings: string[]): Promise<string | undefined> {
    let notes: string | undefined;
    if (env.TENDER_NOTES_AI_ENABLED) {
      try {
        notes = stripCodeFence(await this.generateText(`${NOTES_PROMPT}${text.slice(0, MAX_NOTES_CHARS)}\n"""`));
      } catch {
        warnings.push("AI notes extraction was unavailable — used a basic parser for Terms & Notes.");
      }
    }
    if (!notes) notes = parseTenderNotes(text) ?? undefined;
    if (!notes) return undefined;
    return cleanupNotes(notes) || undefined;
  }

  async extractFromDocument(buffer: Buffer, mimeType: string): Promise<TenderExtractionResultDto> {
    const warnings: string[] = [];
    const text = await this.extractText(buffer, mimeType);

    const notes = await this.extractNotes(text, warnings);

    // Items are parsed deterministically (regex, not the LLM) — a document
    // can have dozens of items, and the 14-digit item code (the whole point
    // of tracking items across tenders) has zero tolerance for the kind of
    // transcription error a small local model can make over a long list.
    const items = parseIiscoRfqItems(text);

    // Header fields for the recognized IISCO/SAIL template are also parsed
    // deterministically — tenderNumber is the DB's @unique key, so it gets
    // the same precision guarantee, and every field this template exposes
    // is mechanically extractable (see tender-header.parser.ts). The LLM is
    // only invoked as a fallback for a document that doesn't match this
    // template at all.
    const deterministic = parseIiscoHeaderFields(text);
    if (deterministic) {
      const { clientName, ...fields } = deterministic;
      const clientMatch = clientName ? await this.matchClient(clientName) : undefined;
      return {
        fields: { ...fields, notes },
        items,
        suggestedClientId: clientMatch?.suggestedClientId,
        suggestedClientName: clientMatch?.suggestedClientName,
        warnings,
      };
    }

    const raw = await this.generateJson(`${FIELD_PROMPT}${text.slice(0, MAX_PROMPT_CHARS)}\n"""`);
    const parsed = extractionSchema.safeParse(raw);
    if (!parsed.success) {
      warnings.push("The model's response did not match the expected format — no fields were extracted.");
      return { fields: { notes }, items, warnings };
    }

    const data = parsed.data;
    const fields: TenderExtractionFields = {
      tenderNumber: data.tenderNumber ?? undefined,
      title: data.title ?? undefined,
      department: data.department ?? undefined,
      type: data.type ?? undefined,
      category: data.category ?? undefined,
      location: data.location ?? undefined,
      state: data.state ?? undefined,
      estimatedCost: data.estimatedCost ?? undefined,
      emdAmount: data.emdAmount ?? undefined,
      tenderFee: data.tenderFee ?? undefined,
      documentFee: data.documentFee ?? undefined,
      submissionDate: data.submissionDate ?? undefined,
      openingDate: data.openingDate ?? undefined,
      validityPeriodDays: data.validityPeriodDays ?? undefined,
      description: data.description ?? undefined,
      remarks: data.remarks ?? undefined,
      notes,
    };

    const clientMatch = data.clientName ? await this.matchClient(data.clientName) : undefined;

    return {
      fields,
      items,
      suggestedClientId: clientMatch?.suggestedClientId,
      suggestedClientName: clientMatch?.suggestedClientName,
      warnings,
    };
  }
}
