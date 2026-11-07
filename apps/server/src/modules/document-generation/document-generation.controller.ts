import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import type { IBoqRepository } from "../boq/boq.repository.js";
import { saveGeneratedTenderDocument } from "../tenders/local-docs/generated-documents.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import { generateUndertaking, type UndertakingFormat } from "./document-generation.service.js";
import {
  generateQuotation,
  generateTenderSheet,
  type QuotationFormat,
  type TenderSheetFormat,
} from "./quotation-document.js";

const QUOTATION_FORMATS: QuotationFormat[] = ["docx", "csv", "pdf"];
const UNDERTAKING_FORMATS: UndertakingFormat[] = ["docx", "pdf"];
const TENDER_SHEET_FORMATS: TenderSheetFormat[] = ["pdf", "docx"];

export class DocumentGenerationController {
  constructor(
    private readonly tendersRepository: ITendersRepository,
    private readonly boqRepository: Pick<IBoqRepository, "findCurrentBoq" | "findItemsByBoqId">,
  ) {}

  generateUndertaking = asyncHandler(async (req, res) => {
    const format = (req.query.format as string | undefined) ?? "pdf";
    if (!UNDERTAKING_FORMATS.includes(format as UndertakingFormat)) {
      throw new BadRequestError("format must be one of: docx, pdf");
    }

    const result = await generateUndertaking(
      this.tendersRepository,
      req.params.id!,
      req.user!.businessId,
      format as UndertakingFormat,
    );

    await saveGeneratedTenderDocument({
      tenderId: result.tenderId,
      tenderNumber: result.tenderNumber,
      tenderTitle: result.tenderTitle,
      businessCode: result.businessCode,
      documentType: "UNDERTAKING",
      filename: result.filename,
      buffer: result.buffer,
      mimeType: result.mimeType,
      uploadedById: req.user!.id,
    });

    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  });

  generateQuotation = asyncHandler(async (req, res) => {
    const format = (req.query.format as string | undefined) ?? "pdf";
    if (!QUOTATION_FORMATS.includes(format as QuotationFormat)) {
      throw new BadRequestError("format must be one of: docx, csv, pdf");
    }

    const result = await generateQuotation(
      this.tendersRepository,
      this.boqRepository,
      req.params.id!,
      req.user!.businessId,
      format as QuotationFormat,
    );

    await saveGeneratedTenderDocument({
      tenderId: result.tenderId,
      tenderNumber: result.tenderNumber,
      tenderTitle: result.tenderTitle,
      businessCode: result.businessCode,
      documentType: "QUOTATION",
      filename: result.filename,
      buffer: result.buffer,
      mimeType: result.mimeType,
      uploadedById: req.user!.id,
    });

    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  });

  // Not saved as a tender Attachment: it's a print/share copy, and a QUOTATION-typed attachment
  // would also count as "quoted" for the Assistant (quotedAtByTender).
  generateTenderSheet = asyncHandler(async (req, res) => {
    const format = (req.query.format as string | undefined) ?? "pdf";
    if (!TENDER_SHEET_FORMATS.includes(format as TenderSheetFormat)) {
      throw new BadRequestError("format must be one of: pdf, docx");
    }

    const result = await generateTenderSheet(
      this.tendersRepository,
      this.boqRepository,
      req.params.id!,
      req.user!.businessId,
      format as TenderSheetFormat,
    );

    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  });
}
