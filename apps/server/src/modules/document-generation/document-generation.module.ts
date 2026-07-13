import { tendersRepository } from "../tenders/tenders.module.js";

import { DocumentGenerationController } from "./document-generation.controller.js";
import { createDocumentGenerationRouter } from "./document-generation.routes.js";

const documentGenerationController = new DocumentGenerationController(tendersRepository);

export const documentGenerationRouter = createDocumentGenerationRouter(documentGenerationController);
