import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import { generateUndertaking } from "./document-generation.service.js";

export class DocumentGenerationController {
  constructor(private readonly tendersRepository: ITendersRepository) {}

  generateUndertaking = asyncHandler(async (req, res) => {
    const buffer = await generateUndertaking(this.tendersRepository, req.params.id!, req.user!.businessId);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader("Content-Disposition", `attachment; filename="Undertaking-${req.params.id}.docx"`);
    res.send(buffer);
  });
}
