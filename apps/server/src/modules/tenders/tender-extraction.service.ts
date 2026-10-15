import { randomUUID } from "node:crypto";

import type { TenderExtractionFields, TenderExtractionResultDto, TenderNotesJobDto } from "@bmp/types";
import { z } from "zod";

import { env } from "../../config/env.js";
import type { ExtractPdfTextOptions } from "../../shared/utils/pdf-text.js";
import type { IOrganizationsRepository } from "../organizations/organizations.repository.js";

import { parseIiscoHeaderFields } from "./tender-header.parser.js";
import { parseIiscoRfqItems } from "./tender-item.parser.js";
import type { ExtractedSection } from "./tender-notes-sections.parser.js";
import { parseIiscoNoteSections } from "./tender-notes-sections.parser.js";
import { parseTenderNotes } from "./tender-notes.parser.js";
import { parseTabularItems } from "./tender-table-items.parser.js";

export type GenerateJsonFn = (prompt: string) => Promise<unknown>;
export type GenerateTextFn = (prompt: string, options?: { timeoutMs?: number }) => Promise<string>;
export type ExtractTextFn = (
  buffer: Buffer,
  mimeType: string,
  options?: ExtractPdfTextOptions,
) => Promise<string>;

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
- submissionDate: the bid/quotation submission deadline. If the document states a time as well as a
  date, return it as an ISO 8601 date-time (YYYY-MM-DDTHH:mm, 24-hour clock, no timezone suffix).
  If only a date is stated, return just the date (YYYY-MM-DD) — never invent a time.
- openingDate: the bid opening date, as an ISO 8601 date (YYYY-MM-DD), if stated
- validityPeriodDays: quotation/offer validity period in days, as a plain integer
- description: a 1-2 sentence description of what is being procured
- remarks: any other short operationally-relevant notes (dealing officer, evaluation criteria) — omit generic legal/boilerplate text
- clientName: the name of the organization issuing the tender

Rules:
- If a field is not present in the text, set it to null. Never guess or invent a value.
- Dates must be ISO 8601 (YYYY-MM-DD, or YYYY-MM-DDTHH:mm for submissionDate when a time is stated)
  or null.
- Numbers must be plain numbers (no currency symbols/commas) or null.

Document text:
"""
`;

// Notes/terms can sit deeper than the header fields (page 2+), so allow a larger window than
// MAX_PROMPT_CHARS — but still bounded, since the item table (irrelevant here) follows.
const MAX_NOTES_CHARS = 16_000;

// A large ITT/notes section pushed against the local model's runtime context window can turn
// into a very slow generation instead of a clean failure — measured against a real tender whose
// ITT section alone ran several minutes with no output, long enough to look like a hung request
// upstream. Bounding the call lets the existing catch-and-fall-back-to-raw-text path (below) take
// over quickly instead of the whole extraction request stalling indefinitely.
const NOTES_CLEANUP_TIMEOUT_MS = 45_000;

/**
 * Total wall-clock the notes cleanup may spend, across every section.
 *
 * A per-section timeout cannot bound the job on its own, because Ollama runs requests one at a
 * time: the per-section calls queue rather than overlap, so the cost is their SUM.
 *
 * This no longer has to fit inside an HTTP request — the cleanup runs in the background and the
 * client polls for it (see startNotesCleanup) — so the budget is only here to stop a wedged job
 * pinning Ollama indefinitely. Sections that do not fit keep their raw extracted text, which is
 * exactly what the AI-off path returns anyway.
 */
const NOTES_TOTAL_BUDGET_MS = 120_000;

/** How long a finished notes job stays readable before it is swept. Generous: the client polls
 *  within seconds, and each job holds one short string. */
const NOTES_JOB_TTL_MS = 10 * 60_000;

interface NotesJob extends TenderNotesJobDto {
  expiresAt: number;
}

// Narrower per-section counterpart to NOTES_PROMPT, used when parseIiscoNoteSections has already
// found and bounded a section deterministically — the model's job shrinks from "find every
// section yourself across the whole document AND copy it verbatim" (which a real document showed
// llama3.1:8b doesn't reliably follow — it paraphrased into a summary despite the section being
// well within its prompt budget) down to "format this one already-identified, already-bounded
// chunk verbatim". Same verbatim/no-paraphrase rules as NOTES_PROMPT, scoped to one section.
function buildSectionCleanupPrompt(section: ExtractedSection): string {
  return `You are formatting ONE already-identified section of a tender document, titled "${section.heading}". Copy it VERBATIM — do not paraphrase, summarize, shorten, translate, or add anything not in the text.

Rules — follow exactly:
- Output exactly one "## ${section.heading}" line, followed by the content.
- Put each distinct point on its own line starting with "- ", copied word for word. If several points are run together (e.g. "1.Inspection... 2.Material..." or separated by "#"), split them so each point is on its own line.
- Do not invent, rename, merge, reorder, or add any heading other than the one given above.
- Output ONLY the markdown (no preamble, no explanation, no code fences).

Text:
"""
${section.text.slice(0, MAX_NOTES_CHARS)}
"""`;
}

// Raw markdown out, not JSON — a big multi-line string wrapped in JSON is needlessly fragile
// (small local models routinely break the escaping). See generateText.
//
// Deliberately strict/verbatim: the model must COPY the document's own notes sections, never
// invent, rename or categorise them. An earlier, looser prompt manufactured "NIT"/"ITT"
// headings that were not in the document — the whole point here is faithful capture, with the
// AI-driven trimming saved for a later, explicit step.
const NOTES_PROMPT = `You copy the notes / terms / instructions text out of a tender document, VERBATIM.

Capture EVERY such section that appears — do not skip any. These sections are usually headed by:
- a line starting with "Note" (e.g. "Note:- Anti-bribery Undertaking:", or a bare "Note:"), or
- a heading like "Instructions to Tenderers (ITT)", "Instructions to Bidders", "NIT", or "Terms and Conditions".
Include a section ONLY if its heading actually appears in the text. If a heading does not appear, do not create it.

Rules — follow exactly:
- Copy the text word for word. Do NOT paraphrase, summarise, translate, shorten, reword, or fix anything.
- Render each heading that appears as a "## <the heading text>" line.
- Do NOT invent, rename, merge, reorder, or re-categorise sections beyond what appears in the text.
- Put each distinct point on its own line starting with "- ", copied verbatim. If several points are run together on one line (e.g. "1.Inspection... 2.Material..." or separated by "#"), split them so each numbered point is on its own line.
- Exclude the repeating page furniture: company letterhead, addresses, GST/CIN numbers, page numbers, dealing-officer row, and the item/BOQ table.
- Exclude the generic participation undertakings — skip any "Anti-bribery Undertaking" section and any "Safety, Environment, Child Labour Undertaking" section entirely.
- If the document has none of these sections, output nothing at all.

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

// Section headings to always drop — generic boilerplate the user never wants tracked. Applied
// deterministically so it holds regardless of what the LLM emits. (A later phase generalises
// this into a learned keep/reject loop.)
const DROP_SECTION = /undertaking/i;

/**
 * Tidy the notes markdown so the output is faithful AND clean, regardless of AI or regex source:
 *  - merge wrapped continuation lines back onto their bullet,
 *  - split numbered points that got glued together with "#" (e.g. "...receipt.#3.Warranty..."),
 *  - drop generic-undertaking sections, empty bullets, and empty headers.
 */
// A boundary between two run-together numbered points on one line: either a "#" separator, or a
// sentence-ending "." directly before "<n>. <Capital>" (e.g. "...Supply.4.Material clearance").
// Requiring a capital after the number avoids splitting decimals/spec numbers like "1.5 M".
const POINT_BOUNDARY = /(?:#\s*|(?<=[.)]))\s*(?=\d+[.)]\s*[A-Z])/;
const NUMBERED_LINE = /^\d+[.)]\s*/;

export function cleanupNotes(markdown: string): string {
  const isPoint = (line: string) =>
    line.startsWith("- ") || line.startsWith("* ") || NUMBERED_LINE.test(line);

  // 1. Merge wrapped continuations (a plain line following a point) back onto that point.
  const merged: string[] = [];
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      merged.push("");
      continue;
    }
    const structural = line.startsWith("#") || isPoint(line);
    const prev = merged[merged.length - 1];
    if (!structural && prev && isPoint(prev)) {
      merged[merged.length - 1] = `${prev} ${line}`;
    } else {
      merged.push(line);
    }
  }

  // 2. Split points glued together on one line (bullet OR numbered), keeping their numbering.
  const split: string[] = [];
  for (const line of merged) {
    if (line.startsWith("#") || line === "") {
      split.push(line);
      continue;
    }
    const core = line
      .replace(/^[-*]\s*/, "")
      .trim()
      // A stray "#" wedged between a point's own number and its text (e.g. "1.#THE RATES..." —
      // seen in this template's NIT section) rather than the usual "...Stores.#2. Inspection..."
      // shape between two points — normalize to a space so POINT_BOUNDARY's existing
      // "\d+[.)]\s*[A-Z]" lookahead matches it like any other point, instead of never matching.
      .replace(/(\d+[.)])#+/g, "$1 ");
    if (!core) continue;
    const pieces = core
      .split(POINT_BOUNDARY)
      .map((p) => p.replace(/#+\s*$/, "").trim())
      .filter(Boolean);
    if (pieces.length > 1 || NUMBERED_LINE.test(core)) {
      // Numbered points keep their own "n." prefix, one per line.
      for (const piece of pieces) split.push(piece);
    } else {
      split.push(`- ${core}`);
    }
  }

  // 3. Drop empty bullets, dropped-heading sections, and empty headers.
  const kept = split.filter((line) => {
    const t = line.trim();
    return t !== "-" && t !== "*" && t !== "•";
  });

  const out: string[] = [];
  let skippingSection = false;
  for (let i = 0; i < kept.length; i += 1) {
    const trimmed = kept[i]!.trim();
    if (trimmed.startsWith("#")) {
      skippingSection = DROP_SECTION.test(trimmed);
      if (skippingSection) continue;
      let hasContent = false;
      for (let j = i + 1; j < kept.length; j += 1) {
        const next = kept[j]!.trim();
        if (next.startsWith("#")) break;
        if (next) {
          hasContent = true;
          break;
        }
      }
      if (!hasContent) continue;
      out.push(kept[i]!);
    } else {
      if (skippingSection) continue;
      out.push(kept[i]!);
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export interface TenderExtractionOptions {
  /** Total wall-clock the AI notes cleanup may spend across ALL sections. */
  notesBudgetMs?: number;
}

/** The section as it reads without the model — also what the AI-off path returns. */
function rawSectionText(section: ExtractedSection): string {
  return `## ${section.heading}\n${section.text.replace(/\s+/g, " ").trim()}`;
}

export class TenderExtractionService {
  private readonly notesBudgetMs: number;
  private readonly notesJobs = new Map<string, NotesJob>();

  constructor(
    private readonly organizationsRepository: IOrganizationsRepository,
    private readonly generateJson: GenerateJsonFn,
    private readonly extractText: ExtractTextFn,
    private readonly generateText: GenerateTextFn,
    options: TenderExtractionOptions = {},
  ) {
    this.notesBudgetMs = options.notesBudgetMs ?? NOTES_TOTAL_BUDGET_MS;
  }

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
   * Notes as they read with no LLM involved — returned immediately by extractFromDocument, and
   * also exactly what the AI-off path returns. Any AI cleanup then runs in the background and
   * replaces this (see startNotesCleanup).
   *
   * For the recognized IISCO/SAIL template, sections (RFQ Description/NIT/ITT/Note) are sliced out
   * deterministically by regex (parseIiscoNoteSections, against layout-mode text — see
   * tender-notes-sections.parser.ts); every other template falls back to parseTenderNotes over the
   * whole document.
   */
  private rawNotes(
    text: string,
    layoutText: string,
  ): { notes?: string; sections?: ExtractedSection[] } {
    const sections = parseIiscoNoteSections(layoutText);
    if (sections) {
      return { notes: cleanupNotes(sections.map(rawSectionText).join("\n\n")) || undefined, sections };
    }
    const parsed = parseTenderNotes(text);
    return { notes: parsed ? cleanupNotes(parsed) || undefined : undefined };
  }

  /**
   * Kicks the LLM cleanup off in the background and returns a job id to poll.
   *
   * Deliberately NOT awaited by the request: a real SAIL document's ITT section alone takes ~30 s
   * against llama3.1:8b, and every proxy in front of this API gives up first — Next's dev rewrite
   * returns a bare `Internal Server Error` at about 30 s, with no JSON and no requestId, and nginx
   * defaults to 60. The upstream kept working and finished fine; nobody was listening. So the
   * extract response carries the raw notes straight away and the client swaps in the cleaned
   * version when this job reports ready.
   */
  // ponytail: in-process Map, so polling must reach the same process that started the job — fine
  // for the single server container this deploys as. Move the job to Redis if the API ever runs
  // more than one replica.
  private startNotesCleanup(text: string, sections: ExtractedSection[] | undefined): string {
    this.sweepNotesJobs();
    const jobId = randomUUID();
    this.notesJobs.set(jobId, {
      status: "pending",
      warnings: [],
      expiresAt: Date.now() + NOTES_JOB_TTL_MS,
    });
    void this.runNotesCleanup(jobId, text, sections);
    return jobId;
  }

  private async runNotesCleanup(
    jobId: string,
    text: string,
    sections: ExtractedSection[] | undefined,
  ): Promise<void> {
    const warnings: string[] = [];
    let notes: string | undefined;
    try {
      notes = sections
        ? await this.cleanSections(sections, warnings)
        : cleanupNotes(
            stripCodeFence(
              await this.generateText(`${NOTES_PROMPT}${text.slice(0, MAX_NOTES_CHARS)}\n"""`, {
                timeoutMs: NOTES_CLEANUP_TIMEOUT_MS,
              }),
            ),
          ) || undefined;
    } catch {
      warnings.push("AI notes cleanup was unavailable — Terms & Notes below are the raw extracted text.");
    }

    const job = this.notesJobs.get(jobId);
    // Already swept (TTL) — the client gave up long ago; nothing to report to.
    if (!job) return;
    this.notesJobs.set(jobId, { ...job, status: "ready", notes, warnings });
  }

  /** Poll target for a background notes cleanup. Undefined once the job has expired. */
  getNotesJob(jobId: string): TenderNotesJobDto | undefined {
    this.sweepNotesJobs();
    const job = this.notesJobs.get(jobId);
    return job && { status: job.status, notes: job.notes, warnings: job.warnings };
  }

  private sweepNotesJobs(): void {
    const now = Date.now();
    for (const [id, job] of this.notesJobs) {
      if (job.expiresAt <= now) this.notesJobs.delete(id);
    }
  }

  /**
   * Each section is cleaned up by the LLM independently and in document order — a real document
   * showed the LLM doesn't reliably follow a "find every section yourself across the whole
   * document AND copy it verbatim" instruction in one shot (it paraphrased into a summary instead,
   * even with the relevant section well within its prompt budget); giving it one already-bounded,
   * already-labeled section at a time is a much narrower, more reliable job.
   */
  private async cleanSections(
    sections: ExtractedSection[],
    warnings: string[],
  ): Promise<string | undefined> {
    // Sequential, not Promise.all: Ollama serialises anyway, so racing them only hid the fact
    // that the total was the sum — and a deadline cannot stop work that has all been started.
    const deadline = Date.now() + this.notesBudgetMs;
    const cleanedParts: string[] = [];
    let ranOutOfTime = false;

    for (const section of sections) {
      // The remaining budget IS the call's timeout — checking the deadline only before starting
      // leaves the call itself unbounded, so one slow section overruns the whole budget.
      const remainingMs = Math.min(deadline - Date.now(), NOTES_CLEANUP_TIMEOUT_MS);
      if (remainingMs <= 0) {
        ranOutOfTime = true;
        cleanedParts.push(rawSectionText(section));
        continue;
      }
      cleanedParts.push(await this.cleanSection(section, warnings, remainingMs));
    }

    if (ranOutOfTime) {
      warnings.push(
        "AI notes cleanup ran out of time — the remaining sections use the raw extracted text.",
      );
    }
    return cleanupNotes(cleanedParts.join("\n\n")) || undefined;
  }

  private async cleanSection(
    section: ExtractedSection,
    warnings: string[],
    timeoutMs: number,
  ): Promise<string> {
    const raw = rawSectionText(section);
    try {
      const cleaned = stripCodeFence(
        await this.generateText(buildSectionCleanupPrompt(section), { timeoutMs }),
      );
      return cleaned || raw;
    } catch {
      warnings.push(`AI notes cleanup was unavailable for "${section.heading}" — used the raw extracted text.`);
      return raw;
    }
  }

  async extractFromDocument(
    buffer: Buffer,
    mimeType: string,
    options: { aiNotesEnabled?: boolean } = {},
  ): Promise<TenderExtractionResultDto> {
    const warnings: string[] = [];
    const text = await this.extractText(buffer, mimeType);

    // Items are parsed deterministically (regex, not the LLM) — a document
    // can have dozens of items, and the 14-digit item code (the whole point
    // of tracking items across tenders) has zero tolerance for the kind of
    // transcription error a small local model can make over a long list.
    //
    // Extracted separately, with `{ layout: true }` — pdftotext's default
    // (non-layout) mode reorders/splits a table row's cells when it sits near
    // a page break, which silently dropped 8 of 13 items on a real multi-page
    // document. `-layout` keeps every row on one physical line and survives
    // page breaks. Not used for `text` above: parseIiscoHeaderFields's
    // regexes are written against the default mode's shape and would break
    // under `-layout` — see pdf-text.ts#ExtractPdfTextOptions. The same
    // layout-mode text is also what parseIiscoNoteSections (in extractNotes
    // below) requires, for the same reason.
    const itemsText = await this.extractText(buffer, mimeType, { layout: true });
    let items = parseIiscoRfqItems(itemsText);

    // Fallback for every other client's format (Word "TnC" sheets, supplier quotation-response
    // workbooks): those arrive as real table markup, so their rows come back with genuine cell
    // separators and can be mapped deterministically — see tender-table-items.parser.ts. Left off
    // the PDF path on purpose: `-layout` text has no reliable cell boundary, so column-guessing
    // there manufactures junk rows instead of finding real ones.
    if (items.length === 0 && mimeType !== "application/pdf") {
      items = parseTabularItems(itemsText);
    }

    // Notes come back raw and instantly; any LLM cleanup is a background job the client polls for
    // (fields.notes is usable as-is meanwhile). The per-request toggle governs the recognized
    // template only — every other document follows the server setting, as before.
    const { notes, sections } = this.rawNotes(text, itemsText);
    const aiNotes = sections
      ? (options.aiNotesEnabled ?? env.TENDER_NOTES_AI_ENABLED)
      : env.TENDER_NOTES_AI_ENABLED;
    const notesJobId =
      aiNotes && (sections?.length || notes) ? this.startNotesCleanup(text, sections) : undefined;

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
        notesJobId,
      };
    }

    const raw = await this.generateJson(`${FIELD_PROMPT}${text.slice(0, MAX_PROMPT_CHARS)}\n"""`);
    const parsed = extractionSchema.safeParse(raw);
    if (!parsed.success) {
      warnings.push("The model's response did not match the expected format — no fields were extracted.");
      return { fields: { notes }, items, warnings, notesJobId };
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
      notesJobId,
    };
  }
}
