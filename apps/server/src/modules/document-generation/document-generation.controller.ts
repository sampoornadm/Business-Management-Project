import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { saveGeneratedTenderDocument } from "../tenders/local-docs/generated-documents.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import { generateUndertaking } from "./document-generation.service.js";

export class DocumentGenerationController {
  constructor(private readonly tendersRepository: ITendersRepository) {}

  generateUndertaking = asyncHandler(async (req, res) => {
    const result = await generateUndertaking(this.tendersRepository, req.params.id!, req.user!.businessId);

    await saveGeneratedTenderDocument({
      tenderId: result.tenderId,
      tenderNumber: result.tenderNumber,
      tenderTitle: result.tenderTitle,
      businessCode: result.businessCode,
      documentType: "UNDERTAKING",
      filename: result.filename,
      buffer: result.buffer,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      uploadedById: req.user!.id,
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.send(result.buffer);
  });
}
