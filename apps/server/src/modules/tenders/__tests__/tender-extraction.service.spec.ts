import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ServiceUnavailableError } from "../../../core/errors/HttpErrors.js";
import type { PaginationParams } from "../../../core/interfaces/pagination.js";
import type {
  IOrganizationsRepository,
  OrganizationFilters,
  OrganizationWithContacts,
} from "../../organizations/organizations.repository.js";
import type { ExtractTextFn, GenerateJsonFn } from "../tender-extraction.service.js";
import { TenderExtractionService } from "../tender-extraction.service.js";

const fakeExtractText: ExtractTextFn = async () => "fake extracted document text";

const TEXT_WITH_ONE_ITEM = `RFQ Item Details
Sl NoItem CodeQtyUoMExpected Delivery
Date
 171301005600045         250.000 M11.04.2026
Material Long Description
:
TUBE MATERIAL: POLYURETHANE
Item Additional
Description:`;

function buildOrganization(overrides: Partial<OrganizationWithContacts> = {}): OrganizationWithContacts {
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
    contacts: [],
    _count: { tenders: 0 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as unknown as OrganizationWithContacts;
}

class FakeOrganizationsRepository implements IOrganizationsRepository {
  organizations = new Map<string, OrganizationWithContacts>();

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

const IISCO_TEMPLATE_TEXT = `IISCO STEEL PLANT
ISP GST : 19AAACS7062F6Z6
Corporate Identity No:
L27109DL1973GOI006454
BID INVITATION
(Kindly scrutinize the dates carefully for timely response submission)
ISP MATERIAL MANAGEMENT DEPARTMENT
Amendment Date:Amendment No:
Contracting Agency:30.06.2026TE Date:
MJ/C06/2026/3776-FLANGE
SLIP
1400013656
RFQ Title:
TE No:
Pur GrpCase FileDealing OfficerE-mailMobile No
METAL PIPESMJ/C06/2026/3776-
FLANGE SLIP
 Paramita Sinhaparamita.sinha@mjunction.in
Tender Header Information
      Page i / *
1Sources for Supply / Execution
07.07.2026 15:00:00 HrsBid Submission Deadline
60Quotation validity in daysTwo Part Bid ResponseBid Type
RFQ Item Details
RFQ Description :
Procurement of FLANGE SLIP
Instructions to Tenderers (ITT) :
Deliver within 120 days.
Sl No Item Code Qty UoM Expected Delivery
Date
 171313000100594 30.000 EA30.10.2026`;

describe("TenderExtractionService", () => {
  it("extracts fields deterministically for a recognized template and never calls the LLM", async () => {
    const organizationsRepository = new FakeOrganizationsRepository();
    const org = buildOrganization({ name: "IISCO STEEL PLANT" });
    organizationsRepository.organizations.set(org.id, org);

    const generateJson: GenerateJsonFn = async () => {
      throw new Error("LLM should not be called for a recognized template");
    };
    const extractText: ExtractTextFn = async () => IISCO_TEMPLATE_TEXT;
    const service = new TenderExtractionService(organizationsRepository, generateJson, extractText);

    const result = await service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf");

    expect(result.fields.tenderNumber).toBe("1400013656");
    expect(result.fields.title).toBe("MJ/C06/2026/3776-FLANGE SLIP");
    expect(result.fields.dealingOfficerName).toBe("Paramita Sinha");
    expect(result.fields.dealingOfficerEmail).toBe("paramita.sinha@mjunction.in");
    expect(result.suggestedClientId).toBe(org.id);
    expect(result.suggestedClientName).toBe("IISCO STEEL PLANT");
    expect(result.items).toEqual([
      { itemCode: "71313000100594", description: "", quantity: 30, unit: "EA" },
    ]);
  });

  it("extracts fields and resolves a confident client match", async () => {
    const organizationsRepository = new FakeOrganizationsRepository();
    const org = buildOrganization();
    organizationsRepository.organizations.set(org.id, org);

    const generateJson: GenerateJsonFn = async () => SAMPLE_PDF_TEXT_RESULT;
    const service = new TenderExtractionService(organizationsRepository, generateJson, fakeExtractText);

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
    const service = new TenderExtractionService(organizationsRepository, generateJson, extractTextWithItems);

    const result = await service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf");

    expect(result.items).toEqual([
      { itemCode: "71301005600045", description: "TUBE MATERIAL: POLYURETHANE", quantity: 250, unit: "M" },
    ]);
  });

  it("returns a suggestion without an id when no confident client match exists", async () => {
    const organizationsRepository = new FakeOrganizationsRepository();
    const generateJson: GenerateJsonFn = async () => SAMPLE_PDF_TEXT_RESULT;
    const service = new TenderExtractionService(organizationsRepository, generateJson, fakeExtractText);

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
    const service = new TenderExtractionService(organizationsRepository, generateJson, fakeExtractText);

    const result = await service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf");

    expect(result.fields).toEqual({});
    expect(result.items).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("propagates ServiceUnavailableError when Ollama is unreachable", async () => {
    const organizationsRepository = new FakeOrganizationsRepository();
    const generateJson: GenerateJsonFn = async () => {
      throw new ServiceUnavailableError("Ollama not reachable");
    };
    const service = new TenderExtractionService(organizationsRepository, generateJson, fakeExtractText);

    await expect(
      service.extractFromDocument(Buffer.from("%PDF-fake"), "application/pdf"),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});
