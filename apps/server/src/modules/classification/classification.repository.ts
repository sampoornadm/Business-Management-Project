import type { PrismaClient } from "@bmp/database";

import type {
  ClassificationRunRecord,
  IClassificationRunRepository,
} from "./classification.rebuild.service.js";
import { abandonMessageFor, STALE_AFTER_MS } from "./classification.recovery.js";

export interface ClassificationRunRow {
  id: string;
  stage: string;
  status: string;
  message: string | null;
  trainedRows: number | null;
  evalAccuracy: number | null;
  evalTopK: number | null;
  baselineAccuracy: number | null;
  deployed: boolean;
  runPath: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  triggeredBy: { firstName: string; lastName: string } | null;
}

export class ClassificationRunRepository implements IClassificationRunRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: { triggeredById: string | null }): Promise<{ id: string }> {
    const run = await this.prisma.classificationRun.create({
      data: { stage: "queued", status: "queued", triggeredById: data.triggeredById },
      select: { id: true },
    });
    return run;
  }

  async update(id: string, data: Record<string, unknown>): Promise<void> {
    await this.prisma.classificationRun.update({ where: { id }, data });
  }

  /** What the Settings card shows: the most recent run, finished or not. */
  async findLatest(): Promise<ClassificationRunRow | null> {
    return this.prisma.classificationRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        stage: true,
        status: true,
        message: true,
        trainedRows: true,
        evalAccuracy: true,
        evalTopK: true,
        baselineAccuracy: true,
        deployed: true,
        runPath: true,
        startedAt: true,
        finishedAt: true,
        triggeredBy: { select: { firstName: true, lastName: true } },
      },
    });
  }

  /** The score a new model has to match, which is the last one actually put into service. */
  async findLastDeployed(): Promise<ClassificationRunRecord | null> {
    return this.prisma.classificationRun.findFirst({
      where: { deployed: true, evalAccuracy: { not: null } },
      orderBy: { startedAt: "desc" },
      select: { evalAccuracy: true },
    });
  }

  /** True while a run is in flight, so the button cannot start a second trainer on the same GPU. */
  async hasRunInProgress(): Promise<boolean> {
    const running = await this.prisma.classificationRun.findFirst({
      where: { status: { in: ["queued", "running"] } },
      select: { id: true },
    });
    return running !== null;
  }

  /** The run Cancel acts on. */
  async findInProgress(): Promise<{ id: string; stage: string } | null> {
    return this.prisma.classificationRun.findFirst({
      where: { status: { in: ["queued", "running"] } },
      orderBy: { startedAt: "desc" },
      select: { id: true, stage: true },
    });
  }

  /**
   * Marks runs whose worker died as failed, so one lost job cannot disable the button forever.
   *
   * Only rows older than STALE_AFTER_MS are touched, so a live run is never reclaimed out from
   * under itself. Called on worker boot and before the in-progress check.
   */
  async failAbandonedRuns(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);
    const abandoned = await this.prisma.classificationRun.findMany({
      where: { status: { in: ["queued", "running"] }, startedAt: { lt: cutoff } },
      select: { id: true, stage: true },
    });

    for (const run of abandoned) {
      await this.prisma.classificationRun.update({
        where: { id: run.id },
        data: { status: "failed", finishedAt: new Date(), message: abandonMessageFor(run.stage) },
      });
    }
    return abandoned.length;
  }

  /**
   * Marks one run failed, for the queue's own failed handler.
   *
   * That handler sees what the service's catch block cannot: a stalled job, and a job whose process
   * was killed. Scoped to unfinished rows so it never overwrites a real result.
   */
  async failRun(id: string, message: string): Promise<void> {
    await this.prisma.classificationRun.updateMany({
      where: { id, status: { in: ["queued", "running"] } },
      data: { status: "failed", finishedAt: new Date(), message },
    });
  }
}
