import { NotFoundError } from "../../core/errors/HttpErrors.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { HsnSacImportService } from "./hsn-sac-import.service.js";
import { toReferenceDataImportDto } from "./reference-data.mapper.js";
import type { IReferenceDataRepository } from "./reference-data.repository.js";

const DATASET_NAME = "HSN_SAC";

export class ReferenceDataController {
  constructor(
    private readonly hsnSacImportService: HsnSacImportService,
    private readonly referenceDataRepository: IReferenceDataRepository,
  ) {}

  status = asyncHandler(async (_req, res) => {
    const latest = await this.referenceDataRepository.findLatestImport(DATASET_NAME);
    sendSuccess(res, latest ? toReferenceDataImportDto(latest) : null, "HSN/SAC status retrieved");
  });

  refresh = asyncHandler(async (req, res) => {
    await this.hsnSacImportService.fetchAndImport(req.user!.id);
    const latest = await this.referenceDataRepository.findLatestImport(DATASET_NAME);
    if (!latest) throw new NotFoundError("No import recorded after refresh");
    sendSuccess(res, toReferenceDataImportDto(latest), "HSN/SAC data refreshed");
  });

  upload = asyncHandler(async (req, res) => {
    if (!req.file) throw new NotFoundError("No file provided");
    await this.hsnSacImportService.importFromBuffer(
      req.file.buffer,
      `upload:${req.file.originalname}`,
      null,
      req.user!.id,
    );
    const latest = await this.referenceDataRepository.findLatestImport(DATASET_NAME);
    if (!latest) throw new NotFoundError("No import recorded after upload");
    sendSuccess(res, toReferenceDataImportDto(latest), "HSN/SAC data imported", 201);
  });
}
