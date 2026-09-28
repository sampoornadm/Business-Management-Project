import { env } from "../../config/env.js";
import { prisma } from "../../infra/prisma/client.js";

import { ClassificationController } from "./classification.controller.js";
import { ClassificationRunRepository } from "./classification.repository.js";
import { createClassificationRouter } from "./classification.routes.js";
import { ClassificationService } from "./classification.service.js";

/**
 * One classifier for the whole process. It holds 470 MB of weights and a 19 MB vector index once
 * loaded, so a second instance would be a second copy of both — and both the API process and the
 * worker process reach it through this singleton.
 *
 * Loading is lazy: constructing this costs nothing, and an install with no trained model never
 * pays for it at all (see ClassificationService#isAvailable, and the fallback in
 * boq-enrichment.service.ts#matchHsnCode).
 */
export const classificationService = new ClassificationService({
  // The threshold is re-read per item from settingsService, so a change on the Settings page takes
  // effect without a restart. This value only matters for a direct call that skips that lookup.
  minConfidence: env.CLASSIFIER_MIN_CONFIDENCE,
});

export const classificationRunRepository = new ClassificationRunRepository(prisma);

const classificationController = new ClassificationController(
  classificationRunRepository,
  classificationService,
);

export const classificationRouter = createClassificationRouter(classificationController);
