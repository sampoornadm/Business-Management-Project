import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import type { IBoqRepository } from "../boq/boq.repository.js";
import { saveGeneratedTenderDocument } from "../tenders/local-docs/generated-documents.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import { generateUndertaking, type UndertakingFormat } from "./document-generation.service.js";
import { generateQuotation, type QuotationFormat } from "./quotation-document.js";

const QUOTATION_FORMATS: QuotationFormat[] = ["docx", "csv", "pdf"];
const UNDERTAKING_FORMATS: UndertakingFormat[] = ["docx", "pdf"];

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
}
