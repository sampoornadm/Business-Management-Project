import type { ClassificationRunDto, ClassificationStatusDto } from "@bmp/types";

import { ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { classificationRebuildQueue } from "../../infra/queue/queues.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import { CANCEL_MESSAGE } from "./classification.cancel.js";
import { trainerRegistry } from "./classification.python.js";
import type { ClassificationRunRepository, ClassificationRunRow } from "./classification.repository.js";
import type { ClassificationService } from "./classification.service.js";

function toDto(run: ClassificationRunRow): ClassificationRunDto {
  return {
    id: run.id,
    stage: run.stage,
    status: run.status,
    message: run.message,
    trainedRows: run.trainedRows,
    evalAccuracy: run.evalAccuracy,
    evalTopK: run.evalTopK,
    baselineAccuracy: run.baselineAccuracy,
    deployed: run.deployed,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    triggeredBy: run.triggeredBy ? `${run.triggeredBy.firstName} ${run.triggeredBy.lastName}` : null,
  };
}

export class ClassificationController {
  constructor(
    private readonly runRepository: ClassificationRunRepository,
    private readonly classificationService: ClassificationService,
  ) {}

  status = asyncHandler(async (_req, res) => {
    const [modelInstalled, latest] = await Promise.all([
      this.classificationService.isAvailable(),
      this.runRepository.findLatest(),
    ]);

    const payload: ClassificationStatusDto = {
      modelInstalled,
      latestRun: latest ? toDto(latest) : null,
    };
    sendSuccess(res, payload, "Classification status retrieved");
  });

  rebuild = asyncHandler(async (req, res) => {
    // Reclaim anything long dead first, or a single lost job would refuse every later attempt.
    await this.runRepository.failAbandonedRuns();

    // One at a time. The trainer wants the whole GPU, and two runs would also race for
    // ml/models/current — so refuse here rather than let the queue serialise them silently.
    if (await this.runRepository.hasRunInProgress()) {
      throw new ConflictError("A classifier rebuild is already running.");
    }

    const run = await this.runRepository.create({ triggeredById: req.user!.id });
    await classificationRebuildQueue.add("rebuild", {
      runId: run.id,
      triggeredById: req.user!.id,
    });

    sendSuccess(res, { runId: run.id }, "Classifier rebuild started", 202);
  });

  /**
   * Stops a rebuild that is in flight.
   *
   * Three things, in this order, because each is useless without the others: kill the trainer so
   * the GPU is actually freed, drain the queue so a restarted worker does not resume the job, and
   * mark the row so the card unblocks. Marking alone would leave a trainer running and let the
   * next Update start a second one.
   */
  cancel = asyncHandler(async (_req, res) => {
    const run = await this.runRepository.findInProgress();
    if (!run) throw new NotFoundError("No classifier rebuild is running.");

    const killed = await trainerRegistry.killCurrent();
    await classificationRebuildQueue.drain(true);
    await this.runRepository.failRun(run.id, CANCEL_MESSAGE);

    sendSuccess(res, { runId: run.id, trainerStopped: killed }, "Classifier rebuild cancelled");
  });
}
