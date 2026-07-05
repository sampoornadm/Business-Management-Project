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

describe("TenderExtractionService", () => {
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
