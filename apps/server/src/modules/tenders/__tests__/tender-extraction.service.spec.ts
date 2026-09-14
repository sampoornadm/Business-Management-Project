import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ServiceUnavailableError } from "../../../core/errors/HttpErrors.js";
import type { PaginationParams } from "../../../core/interfaces/pagination.js";
import type {
  IOrganizationsRepository,
  OrganizationFilters,
  OrganizationEntity,
} from "../../organizations/organizations.repository.js";
import type { ExtractTextFn, GenerateJsonFn, GenerateTextFn } from "../tender-extraction.service.js";
import { cleanupNotes, TenderExtractionService } from "../tender-extraction.service.js";

const fakeExtractText: ExtractTextFn = async () => "fake extracted document text";
// Notes extraction is a separate concern from field extraction; default it to empty so these
// field-focused tests exercise the deterministic/regex path and stay offline.
const fakeGenerateText: GenerateTextFn = async () => "";

// Real `pdftotext` CLI output (not a hand-typed guess) — see
// tender-header.parser.spec.ts for why that matters.
const TEXT_WITH_ONE_ITEM = `RFQ Item Details
RFQ Description :
AUTO COUPLER O RING 42 MM

Sl No

Item Code

Qty

UoM

1
71804001603937
1,500.000
EA
Material Long Description O-RING MATERIAL : FKM
Item Additional
Description:`;

function buildOrganization(overrides: Partial<OrganizationEntity> = {}): OrganizationEntity {
  const now = new Date();
  return {
    id: randomUUID(),
    name: "IISCO Steel Plant",
    type: "GOVERNMENT",
    address: null,
    city: null,
    state: null,
    pincode: null,
    gstNumber: null,
    website: null,
    notes: null,
    createdById: randomUUID(),
    _count: { tenders: 0 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as unknown as OrganizationEntity;
}

class FakeOrganizationsRepository implements IOrganizationsRepository {
  organizations = new Map<string, OrganizationEntity>();

  async findById(id: string) {
    return this.organizations.get(id) ?? null;
  }

  async findMany(_pagination: PaginationParams, filters: OrganizationFilters) {
    let items = [...this.organizations.values()];
    if (filters.search) {
      const search = filters.search.toLowerCase();
      items = items.filter((org) => org.name.toLowerCase().includes(search));
    }
    return { items, totalItems: items.length };
  }

  async create() {
    throw new Error("not implemented");
  }

  async update() {
    throw new Error("not implemented");
  }

  async delete() {
    throw new Error("not implemented");
  }

  async countTenders() {
    return 0;
  }

  async createContact() {}

  async updateContact() {}

  async deleteContact() {}
}

const SAMPLE_PDF_TEXT_RESULT = {
  tenderNumber: "1400013656",
  title: "Procurement of Flange Slip",
  department: "ISP MATERIAL MANAGEMENT DEPARTMENT",
  type: "e-Procurement",
  category: "Metal Pipes",
  location: null,
  state: null,
  estimatedCost: null,
  emdAmount: null,
  tenderFee: null,
  documentFee: null,
  submissionDate: "2026-07-07",
  openingDate: null,
  validityPeriodDays: 60,
  description: "Procurement of flange slips for ISP.",
  remarks: "Dealing Officer: Paramita Sinha.",
  clientName: "IISCO Steel Plant",
};

// Real `pdftotext` CLI output (not a hand-typed guess) — see
// tender-header.parser.spec.ts for why that matters.
const IISCO_TEMPLATE_TEXT = `BID INVITATION
(Kindly scrutinize the dates carefully for timely response submission)

TE No:
RFQ Title:

1400013427
MJ/C07/2026/3465

TE Date:
30.05.2026
Amendment No:

Contracting Agency:
Amendment Date:

IISCO STEEL PLANT
ISP GST : 19AAACS7062F6Z6
Corporate Identity No:
L27109DL1973GOI006454
ISP MATERIAL MANAGEMENT DEPARTMENT

Pur Grp

Case File

Dealing Officer

E-mail

PACKAG, RUBBER MATL

MJ/C07/2026/3465

Avishek Mozumder

Mozumder.Avishek@mjunction.
in

Mobile No

Tender Header Information

Page i / 3

BID INVITATION
(Kindly scrutinize the dates carefully for timely response submission)

TE No:
RFQ Title:

1400013427
MJ/C07/2026/3465

Bid Type
Type
Price Bid Option
RA Applicable
Evaluation Criteria
Bid Submission Deadline
Sources for Supply / Execution

TE Date:
30.05.2026
Amendment No:

Two Part Bid Response
e-Procurement
e-Procurement
No
Overall
06.06.2026 15:00:00 Hrs
1

Contracting Agency:
Amendment Date:

Quotation validity in days

IISCO STEEL PLANT
ISP GST : 19AAACS7062F6Z6
Corporate Identity No:
L27109DL1973GOI006454
ISP MATERIAL MANAGEMENT DEPARTMENT

60

RFQ Item Details
RFQ Description :
AUTO COUPLER O RING 42 MM
Instructions to Tenderers (ITT) :
Deliver within 120 days.

Sl No

Item Code

Qty

UoM

1
71804001603937
1,500.000
EA
Material Long Description O-RING MATERIAL : FKM
Item Additional
Description:`;

describe("TenderExtractionService", () => {
  it("extracts fields deterministically for a recognized template and never calls the LLM", async () => {
    const organizationsRepository = new FakeOrganizationsRepository();
    const org = buildOrganization({ name: "IISCO STEEL PLANT" });
    organizationsRepository.organizations.set(org.id, org);

    const generateJson: GenerateJsonFn = async () => {
      throw new Error("LLM should not be called for a recognized template");
    };
    const extractText: ExtractTextFn = async () => IISCO_TEMPLATE_TEXT;
    const service = new TenderExtractionService(organizationsRepository, generateJson, extractText, fakeGenerateText);

    const result = await service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf");

    expect(result.fields.tenderNumber).toBe("1400013427");
    expect(result.fields.title).toBe("MJ/C07/2026/3465");
    expect(result.fields.dealingOfficerName).toBe("Avishek Mozumder");
    expect(result.fields.dealingOfficerEmail).toBe("Mozumder.Avishek@mjunction.in");
    expect(result.suggestedClientId).toBe(org.id);
    expect(result.suggestedClientName).toBe("IISCO STEEL PLANT");
    expect(result.items).toEqual([
      { itemCode: "71804001603937", description: "O-RING MATERIAL : FKM", quantity: 1500, unit: "EA" },
    ]);
    // IISCO_TEMPLATE_TEXT has an "Instructions to Tenderers (ITT)" heading, so this now also
    // exercises the new section-split notes path (parseIiscoNoteSections finds RFQ Description +
    // ITT; fakeGenerateText returns "" for each, so both fall back to their raw section text).
    // Locked in explicitly so a future change to that path can't silently regress this fixture.
    expect(result.fields.notes).toBe(
      "## RFQ Description\n- AUTO COUPLER O RING 42 MM\n\n## Instructions to Tenderers (ITT)\n- Deliver within 120 days.",
    );
  });

  it("extracts fields and resolves a confident client match", async () => {
    const organizationsRepository = new FakeOrganizationsRepository();
    const org = buildOrganization();
    organizationsRepository.organizations.set(org.id, org);

    const generateJson: GenerateJsonFn = async () => SAMPLE_PDF_TEXT_RESULT;
    const service = new TenderExtractionService(organizationsRepository, generateJson, fakeExtractText, fakeGenerateText);

    const result = await service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf");

    expect(result.fields.tenderNumber).toBe("1400013656");
    expect(result.fields.department).toBe("ISP MATERIAL MANAGEMENT DEPARTMENT");
    expect(result.fields.submissionDate).toBe("2026-07-07");
    expect(result.fields.validityPeriodDays).toBe(60);
    expect(result.suggestedClientId).toBe(org.id);
    expect(result.suggestedClientName).toBe("IISCO Steel Plant");
    expect(result.warnings).toHaveLength(0);
  });

  it("extracts items deterministically from the document text alongside the LLM fields", async () => {
    const organizationsRepository = new FakeOrganizationsRepository();
    const generateJson: GenerateJsonFn = async () => SAMPLE_PDF_TEXT_RESULT;
    const extractTextWithItems: ExtractTextFn = async () => TEXT_WITH_ONE_ITEM;
    const service = new TenderExtractionService(organizationsRepository, generateJson, extractTextWithItems, fakeGenerateText);

    const result = await service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf");

    expect(result.items).toEqual([
      { itemCode: "71804001603937", description: "O-RING MATERIAL : FKM", quantity: 1500, unit: "EA" },
    ]);
  });

  it("requests the item text separately, with { layout: true }, rather than reusing the header text", async () => {
    const organizationsRepository = new FakeOrganizationsRepository();
    const generateJson: GenerateJsonFn = async () => SAMPLE_PDF_TEXT_RESULT;
    const calls: Array<{ layout?: boolean }> = [];
    const extractText: ExtractTextFn = async (_buffer, _mimeType, options) => {
      calls.push({ layout: options?.layout });
      // Only the `{ layout: true }` call returns text an item can be parsed from —
      // proves the service actually uses that call's result for items, not the
      // (layout-less) header-fields call's result.
      return options?.layout ? TEXT_WITH_ONE_ITEM : "no item table here";
    };
    const service = new TenderExtractionService(organizationsRepository, generateJson, extractText, fakeGenerateText);

    const result = await service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf");

    expect(calls).toEqual([{ layout: undefined }, { layout: true }]);
    expect(result.items).toEqual([
      { itemCode: "71804001603937", description: "O-RING MATERIAL : FKM", quantity: 1500, unit: "EA" },
    ]);
  });

  it("returns a suggestion without an id when no confident client match exists", async () => {
    const organizationsRepository = new FakeOrganizationsRepository();
    const generateJson: GenerateJsonFn = async () => SAMPLE_PDF_TEXT_RESULT;
    const service = new TenderExtractionService(organizationsRepository, generateJson, fakeExtractText, fakeGenerateText);

    const result = await service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf");

    expect(result.suggestedClientId).toBeUndefined();
    expect(result.suggestedClientName).toBe("IISCO Steel Plant");
  });

  it("returns empty fields with a warning when the model's response does not match the schema", async () => {
    const organizationsRepository = new FakeOrganizationsRepository();
    // Every field in extractionSchema is nullish/optional, so an object with
    // unexpected keys would still parse fine — only a non-object response
    // (e.g. the model ignoring the JSON-object instruction) actually fails
    // z.object()'s validation.
    const generateJson: GenerateJsonFn = async () => "not an object";
    const service = new TenderExtractionService(organizationsRepository, generateJson, fakeExtractText, fakeGenerateText);

    const result = await service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf");

    expect(result.fields).toEqual({});
    expect(result.items).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("cleans notes markdown: merges wraps, splits run-together points, drops undertakings and empties", () => {
    const raw = [
      "## Note:- Anti-bribery Undertaking:",
      "- Suppliers shall not give or take any bribe.",
      "",
      "## Instructions to Tenderers (ITT) :",
      // Points run together on one line, split by "#" AND by a bare "." — and wrapped.
      "1.Inspection to be done at MM Stores.2.Material to be used on",
      "receipt.#3.Warranty to Accompany Supply.4.Material clearance within 05 days.",
      "",
      "## Empty Section",
      "-",
    ].join("\n");

    const out = cleanupNotes(raw);

    // Undertaking section dropped entirely; empty section dropped.
    expect(out).not.toContain("Anti-bribery");
    expect(out).not.toContain("Empty Section");
    expect(out).toContain("## Instructions to Tenderers (ITT) :");
    // Each numbered point on its own line, keeping its number — including the "#3" and ".4" glue.
    expect(out).toContain("1.Inspection to be done at MM Stores.");
    expect(out).toContain("2.Material to be used on receipt.");
    expect(out).toContain("3.Warranty to Accompany Supply.");
    // "within 05 days" stays inside point 4 rather than splitting into a bogus "05" point.
    expect(out).toContain("4.Material clearance within 05 days.");
  });

  it("cleans notes markdown: splits points where a stray '#' sits between the number and its text (NIT section shape)", () => {
    // Real shape from a NIT section: "##1.#THE RATES..." — a stray "#" wedged between the
    // point's own number and its text, unlike the more common "...Stores.#2. Inspection..."
    // glue between two DIFFERENT points that the other test above already covers.
    const raw = [
      "## Notice Inviting Tender (NIT)",
      "RFx Terms & Condition ##1.#THE RATES QUOTED SHOULD BE F.O.R. DESTINATION BASIS.#2.#OUR PAYMENT TERM IS 100% within 30 days after GRN",
    ].join("\n");

    const out = cleanupNotes(raw);

    expect(out).toContain("1. THE RATES QUOTED SHOULD BE F.O.R. DESTINATION BASIS.");
    expect(out).toContain("2. OUR PAYMENT TERM IS 100% within 30 days after GRN");
    // No leftover "#" glued onto the point text.
    expect(out).not.toMatch(/\d\.#/);
  });

  it("propagates ServiceUnavailableError when Ollama is unreachable", async () => {
    const organizationsRepository = new FakeOrganizationsRepository();
    const generateJson: GenerateJsonFn = async () => {
      throw new ServiceUnavailableError("Ollama not reachable");
    };
    const service = new TenderExtractionService(organizationsRepository, generateJson, fakeExtractText, fakeGenerateText);

    await expect(
      service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf"),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  describe("section-split notes extraction (IISCO/SAIL template)", () => {
    // No "TE No:" anchor, so parseIiscoHeaderFields returns null and header fields fall back to
    // the generic LLM path — irrelevant to these tests, which are only about the notes path.
    const NO_HEADER_TEXT = "This document has no recognized header anchor.";

    // Layout-mode text with all 4 sections, built the same way as
    // tender-notes-sections.parser.spec.ts's fixture, trimmed to what these tests need.
    const FOUR_SECTION_LAYOUT_TEXT = `RFQ Description :
SELF ADHESSIVE PVC INSULATING TAPE 360 EA

Notice Inviting Tender (NIT) :
1.#THE RATES QUOTED SHOULD BE F.O.R. DESTINATION BASIS.#Note: SAIL ISP shall issue the Goods Receipt and
Acceptance Note (GRN) and auto generated mail shall be sent for the same.

Instructions to Tenderers (ITT) :
3. Warranty certificate to be provided with material.##4. Delivery Schedule: 105 days from PO placement.#Note: SAIL ISP shall issue the Goods Receipt and
Acceptance Note (GRN) and auto generated mail shall be sent for the same.

 Sl No                     Item Code                      Qty                              UoM                    Expected Delivery
                                                                                                                  Date`;

    function extractTextForFourSections(): ExtractTextFn {
      return async (_buffer, _mimeType, options) => (options?.layout ? FOUR_SECTION_LAYOUT_TEXT : NO_HEADER_TEXT);
    }

    it("calls generateText once per section, with 4 distinct section-scoped prompts (not the old whole-document prompt)", async () => {
      const organizationsRepository = new FakeOrganizationsRepository();
      const generateJson: GenerateJsonFn = async () => SAMPLE_PDF_TEXT_RESULT;
      const prompts: string[] = [];
      const generateText: GenerateTextFn = async (prompt) => {
        prompts.push(prompt);
        return "";
      };
      const service = new TenderExtractionService(
        organizationsRepository,
        generateJson,
        extractTextForFourSections(),
        generateText,
      );

      await service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf");

      expect(prompts).toHaveLength(4);
      expect(new Set(prompts).size).toBe(4);
      for (const prompt of prompts) {
        expect(prompt).not.toContain("You copy the notes / terms / instructions text out of a tender document");
      }
    });

    it("keeps sections in fixed document order even when their AI calls resolve out of order", async () => {
      const organizationsRepository = new FakeOrganizationsRepository();
      const generateJson: GenerateJsonFn = async () => SAMPLE_PDF_TEXT_RESULT;
      let callIndex = 0;
      const generateText: GenerateTextFn = async (prompt) => {
        const index = callIndex++;
        const headingMatch = prompt.match(/titled "([^"]+)"/);
        const heading = headingMatch![1];
        // Resolve in REVERSE call order (last call resolves first) — if the result were assembled
        // by resolution order instead of the sections' own document order, this would reorder them.
        await new Promise((resolve) => setTimeout(resolve, (4 - index) * 5));
        return `## ${heading}\n- cleaned ${heading}`;
      };
      const service = new TenderExtractionService(
        organizationsRepository,
        generateJson,
        extractTextForFourSections(),
        generateText,
      );

      const result = await service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf");

      const headingOrder = ["RFQ Description", "Notice Inviting Tender (NIT)", "Instructions to Tenderers (ITT)", "Note"];
      const positions = headingOrder.map((heading) => result.fields.notes!.indexOf(`## ${heading}`));
      expect(positions.every((p) => p >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });

    it("falls back to raw section text and warns when exactly one section's AI call fails, without affecting the others", async () => {
      const organizationsRepository = new FakeOrganizationsRepository();
      const generateJson: GenerateJsonFn = async () => SAMPLE_PDF_TEXT_RESULT;
      const generateText: GenerateTextFn = async (prompt) => {
        if (prompt.includes("Notice Inviting Tender (NIT)")) {
          throw new Error("Ollama hiccup for this one section");
        }
        const heading = prompt.match(/titled "([^"]+)"/)![1];
        return `## ${heading}\n- cleaned ${heading}`;
      };
      const service = new TenderExtractionService(
        organizationsRepository,
        generateJson,
        extractTextForFourSections(),
        generateText,
      );

      const result = await service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf");

      // The failed section still appears, via its raw (un-AI-cleaned) text — not dropped.
      expect(result.fields.notes).toContain("## Notice Inviting Tender (NIT)");
      expect(result.fields.notes).toContain("THE RATES QUOTED SHOULD BE F.O.R. DESTINATION BASIS");
      // The other three sections were cleaned normally.
      expect(result.fields.notes).toContain("cleaned RFQ Description");
      expect(result.fields.notes).toContain("cleaned Instructions to Tenderers (ITT)");
      expect(result.fields.notes).toContain("cleaned Note");
      expect(result.warnings).toEqual([
        'AI notes extraction was unavailable for "Notice Inviting Tender (NIT)" — used the raw extracted text.',
      ]);
    });

    it("skips the LLM entirely and returns deterministic raw section text when aiNotesEnabled is explicitly false", async () => {
      const organizationsRepository = new FakeOrganizationsRepository();
      const generateJson: GenerateJsonFn = async () => SAMPLE_PDF_TEXT_RESULT;
      let generateTextCalls = 0;
      const generateText: GenerateTextFn = async () => {
        generateTextCalls++;
        throw new Error("generateText should not be called when aiNotesEnabled is false");
      };
      const service = new TenderExtractionService(
        organizationsRepository,
        generateJson,
        extractTextForFourSections(),
        generateText,
      );

      const result = await service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf", {
        aiNotesEnabled: false,
      });

      expect(generateTextCalls).toBe(0);
      expect(result.warnings).toEqual([]);
      expect(result.fields.notes).toContain("## Notice Inviting Tender (NIT)");
      expect(result.fields.notes).toContain("THE RATES QUOTED SHOULD BE F.O.R. DESTINATION BASIS");
      expect(result.fields.notes).toContain("3. Warranty certificate to be provided with material.");
    });
  });
});
