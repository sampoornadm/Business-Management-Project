import type { Prisma, PrismaClient, TenderSubmission } from "@bmp/database";
import type { SubmissionChanges, TenderSubmissionLineDto } from "@bmp/types";

export type TenderSubmissionRow = TenderSubmission;

export interface CreateTenderSubmissionData {
  businessId: string;
  tenderId: string;
  number: number;
  submissionReference: string | null;
  totalAmount: number;
  lines: TenderSubmissionLineDto[];
  changes: SubmissionChanges | null;
  summary: string;
  submittedById: string;
}

export interface ITenderSubmissionsRepository {
  findLatest(tenderId: string, businessId: string): Promise<TenderSubmissionRow | null>;
  create(data: CreateTenderSubmissionData): Promise<TenderSubmissionRow>;
}

/** Numbered, insert-only submission snapshots of a tender (never updated or deleted by the app). */
export class TenderSubmissionsRepository implements ITenderSubmissionsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findLatest(tenderId: string, businessId: string): Promise<TenderSubmissionRow | null> {
    return this.prisma.tenderSubmission.findFirst({
      where: { tenderId, businessId },
      orderBy: { number: "desc" },
    });
  }

  create(data: CreateTenderSubmissionData): Promise<TenderSubmissionRow> {
    return this.prisma.tenderSubmission.create({
      data: {
        ...data,
        lines: data.lines as unknown as Prisma.InputJsonValue,
        changes: (data.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
