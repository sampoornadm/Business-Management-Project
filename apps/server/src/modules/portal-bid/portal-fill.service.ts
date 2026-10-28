import { randomUUID } from "node:crypto";

import type { PortalFillJobDto, PortalFillResultDto } from "@bmp/types";

import { ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import type { AuditService } from "../audit/audit.service.js";
import type { ITendersRepository } from "../tenders/tenders.repository.js";

import type { BidPayloadService } from "./bid-payload.service.js";
import { fillBid, type IPortalSession } from "./portal/fill-bid.js";
import type { IPortalBidRepository } from "./portal-bid.repository.js";

export interface PortalFillRun {
  tenderId: string;
  businessId: string;
  actorId: string;
  onProgress: (percent: number) => void;
}
export type PortalFillRunner = (run: PortalFillRun) => Promise<PortalFillResultDto>;

const JOB_KEEP_MS = 60 * 60 * 1000;

interface Job extends PortalFillJobDto {
  businessId: string;
  finishedAt?: number;
}

/**
 * Runs one portal fill at a time per business in the background and lets the browser poll it.
 * The jobs live in this process's memory: a server restart forgets them, which only costs the
 * progress bar of a fill that the restart killed anyway.
 */
export class PortalFillService {
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly runner: PortalFillRunner) {}

  start(tenderId: string, businessId: string, actorId: string): PortalFillJobDto {
    this.prune();
    for (const job of this.jobs.values()) {
      if (job.businessId === businessId && job.status === "running") {
        throw new ConflictError("A portal fill is already running; wait for it to finish");
      }
    }
    const job: Job = { id: randomUUID(), tenderId, businessId, status: "running", progress: 0 };
    this.jobs.set(job.id, job);
    void this.runner({ tenderId, businessId, actorId, onProgress: (percent) => (job.progress = percent) })
      .then((result) => {
        job.status = "done";
        job.progress = 100;
        job.result = result;
      })
      .catch((error: unknown) => {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        job.finishedAt = Date.now();
      });
    return this.view(job);
  }

  get(jobId: string, businessId: string): PortalFillJobDto {
    const job = this.jobs.get(jobId);
    if (!job || job.businessId !== businessId) throw new NotFoundError("Fill job not found");
    return this.view(job);
  }

  private view({ businessId: _businessId, finishedAt: _finishedAt, ...job }: Job): PortalFillJobDto {
    return job;
  }

  private prune(): void {
    const cutoff = Date.now() - JOB_KEEP_MS;
    for (const [id, job] of this.jobs) if (job.finishedAt && job.finishedAt < cutoff) this.jobs.delete(id);
  }
}

interface RunnerDeps {
  tenders: Pick<ITendersRepository, "findById">;
  payloads: Pick<BidPayloadService, "buildPayload">;
  portalBids: IPortalBidRepository;
  audit: Pick<AuditService, "log">;
  /** The open bid response to fill; throws with a user-readable message when there is none. */
  attach: () => Promise<IPortalSession & { disconnect(): Promise<void> }>;
}

/** Fills the open SAIL ISP response for a tender, typing only; it never saves or submits. */
export function createPortalFillRunner(deps: RunnerDeps): PortalFillRunner {
  return async ({ tenderId, businessId, actorId, onProgress }) => {
    const tender = await deps.tenders.findById(tenderId, businessId);
    if (!tender) throw new NotFoundError("Tender not found");
    const payload = await deps.payloads.buildPayload(tenderId, businessId, "SAIL_ISP");

    const session = await deps.attach();
    try {
      const result = await fillBid(
        {
          session,
          payload,
          tenderNumber: tender.tenderNumber,
          businessId,
          tenderId,
          dryRun: false,
          // Nothing is saved or submitted by this run, so the portal stays the user's to review.
          confirm: async () => true,
          onProgress,
          actorId,
          source: "web",
        },
        { portalBids: deps.portalBids, audit: deps.audit },
      );
      return { ...result, warnings: payload.warnings };
    } finally {
      await session.disconnect().catch(() => undefined);
    }
  };
}
