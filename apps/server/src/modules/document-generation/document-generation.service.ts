import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

import { env } from "../../config/env.js";
import { NotFoundError } from "../../core/errors/HttpErrors.js";
import { expandHome } from "../tenders/local-docs/folder-naming.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

export type DocumentType = "undertaking" | "signature";

export interface TemplateStatus {
  documentType: DocumentType;
  filename: string;
  path: string;
  exists: boolean;
  lastModifiedAt: string | null;
}

const TEMPLATE_FILENAMES: Record<DocumentType, string> = {
  undertaking: "undertaking.docx",
  signature: "signature.png",
};

export function getTemplatePath(businessCode: string, documentType: DocumentType): string {
  return path.join(
    expandHome(env.BUSINESSES_ROOT_DIR),
    businessCode,
    "templates",
    TEMPLATE_FILENAMES[documentType],
  );
}

export async function getTemplateStatus(
  businessCode: string,
  documentType: DocumentType,
): Promise<TemplateStatus> {
  const templatePath = getTemplatePath(businessCode, documentType);
  try {
    const stats = await stat(templatePath);
    return {
      documentType,
      filename: TEMPLATE_FILENAMES[documentType],
      path: templatePath,
      exists: true,
      lastModifiedAt: stats.mtime.toISOString(),
    };
  } catch {
    return {
      documentType,
      filename: TEMPLATE_FILENAMES[documentType],
      path: templatePath,
      exists: false,
      lastModifiedAt: null,
    };
  }
}

export function fillDocxTemplate(templateBuffer: Buffer, data: Record<string, unknown>): Buffer {
  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
    nullGetter: () => "",
  });
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer" });
}

export function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getFullYear()}`;
}

export interface GeneratedUndertaking {
  buffer: Buffer;
  filename: string;
  tenderId: string;
  tenderNumber: string;
  tenderTitle: string;
  businessCode: string;
}

export async function generateUndertaking(
  tendersRepository: Pick<ITendersRepository, "findForDocumentGeneration">,
  tenderId: string,
  businessId: string,
): Promise<GeneratedUndertaking> {
  const tender = await tendersRepository.findForDocumentGeneration(tenderId, businessId);
  if (!tender) throw new NotFoundError("Tender not found");

  const status = await getTemplateStatus(tender.business.code, "undertaking");
  if (!status.exists) {
    throw new NotFoundError(
      `Undertaking template not found for ${tender.business.code}. Place it at ${status.path}`,
    );
  }

  const templateBuffer = await readFile(status.path);
  const generatedDate = formatDate(new Date());
  const data: Record<string, string> = {
    tenderNumber: tender.tenderNumber,
    tenderTitle: tender.title,
    tenderDepartment: tender.department ?? "",
    businessName: tender.business.name,
    businessAddress: tender.business.address ?? "",
    businessGstNumber: tender.business.gstNumber ?? "",
    businessPanNumber: tender.business.panNumber ?? "",
    clientOrganizationName: tender.client.name,
    clientOrganizationAddress: tender.client.address ?? "",
    generatedDate,
  };

  const buffer = fillDocxTemplate(templateBuffer, data);

  return {
    buffer,
    filename: `Undertaking-${tender.tenderNumber}-${generatedDate}.docx`,
    tenderId,
    tenderNumber: tender.tenderNumber,
    tenderTitle: tender.title,
    businessCode: tender.business.code,
  };
}
