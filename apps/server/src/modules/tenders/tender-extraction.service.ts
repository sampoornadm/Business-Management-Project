import type { TenderExtractionFields, TenderExtractionResultDto } from "@bmp/types";
import { z } from "zod";

import type { IOrganizationsRepository } from "../organizations/organizations.repository.js";

import { parseIiscoRfqItems } from "./tender-item.parser.js";

export type GenerateJsonFn = (prompt: string) => Promise<unknown>;
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

export class TenderExtractionService {
  constructor(
    private readonly organizationsRepository: IOrganizationsRepository,
    private readonly generateJson: GenerateJsonFn,
    private readonly extractText: ExtractTextFn,
  ) {}

  async extractFromDocument(buffer: Buffer, mimeType: string): Promise<TenderExtractionResultDto> {
    const warnings: string[] = [];
    const text = await this.extractText(buffer, mimeType);

    // Items are parsed deterministically (regex, not the LLM) — a document
    // can have dozens of items, and the 14-digit item code (the whole point
    // of tracking items across tenders) has zero tolerance for the kind of
    // transcription error a small local model can make over a long list.
    const items = parseIiscoRfqItems(text);

    const raw = await this.generateJson(`${FIELD_PROMPT}${text.slice(0, MAX_PROMPT_CHARS)}\n"""`);
    const parsed = extractionSchema.safeParse(raw);
    if (!parsed.success) {
      warnings.push("The model's response did not match the expected format — no fields were extracted.");
      return { fields: {}, items, warnings };
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
    };

    let suggestedClientId: string | undefined;
    let suggestedClientName: string | undefined;
    if (data.clientName) {
      suggestedClientName = data.clientName;
      const matches = await this.organizationsRepository.findMany(
        { page: 1, pageSize: 5 },
        { search: data.clientName },
      );
      if (matches.items.length === 1) {
        suggestedClientId = matches.items[0]!.id;
      }
    }

    return { fields, items, suggestedClientId, suggestedClientName, warnings };
  }
}
