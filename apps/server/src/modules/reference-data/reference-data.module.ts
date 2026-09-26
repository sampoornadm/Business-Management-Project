import { prisma } from "../../infra/prisma/client.js";

import { HsnSacImportService } from "./hsn-sac-import.service.js";
import { ReferenceDataController } from "./reference-data.controller.js";
import { ReferenceDataRepository } from "./reference-data.repository.js";
import { createReferenceDataRouter } from "./reference-data.routes.js";

export const referenceDataRepository = new ReferenceDataRepository(prisma);
export const hsnSacImportService = new HsnSacImportService(referenceDataRepository);
const referenceDataController = new ReferenceDataController(hsnSacImportService, referenceDataRepository);

export const referenceDataRouter = createReferenceDataRouter(referenceDataController);
