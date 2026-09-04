import { boqRepository } from "../boq/boq.module.js";
import { tendersRepository } from "../tenders/tenders.module.js";

import { DocumentGenerationController } from "./document-generation.controller.js";
import { createDocumentGenerationRouter } from "./document-generation.routes.js";

const documentGenerationController = new DocumentGenerationController(tendersRepository, boqRepository);

export const documentGenerationRouter = createDocumentGenerationRouter(documentGenerationController);
