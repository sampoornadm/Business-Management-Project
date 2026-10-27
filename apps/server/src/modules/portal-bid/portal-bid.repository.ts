import type { Prisma, PrismaClient, PortalBidStatus } from "@bmp/database";

import type { IPortalProfileRepository } from "./bid-payload.service.js";

export interface UpsertPortalBidInput {
  businessId: string;
  tenderId: string;
  portalCode: string;
  responseNumber: string;
  submissionDeadline: Date | null;
  totalValue: number | null;
  summary: Prisma.InputJsonValue;
}

export interface IPortalBidRepository {
  upsertFromFill(input: UpsertPortalBidInput): Promise<void>;
  /** Business-scoped: a response number resolves only inside the business that filed it. */
  findByResponseNumber(
    businessId: string,
    portalCode: string,
    responseNumber: string,
  ): Promise<{ tenderId: string; tenderNumber: string; status: PortalBidStatus } | null>;
}

export class PortalBidRepository implements IPortalBidRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertFromFill(input: UpsertPortalBidInput): Promise<void> {
    const data = {
      responseNumber: input.responseNumber,
      submissionDeadline: input.submissionDeadline,
      totalValue: input.totalValue,
      lastFilledAt: new Date(),
      lastFillSummary: input.summary,
    };
    await this.prisma.portalBid.upsert({
      where: { tenderId_portalCode: { tenderId: input.tenderId, portalCode: input.portalCode } },
      create: { ...data, businessId: input.businessId, tenderId: input.tenderId, portalCode: input.portalCode },
      update: data,
    });
  }

  async findByResponseNumber(businessId: string, portalCode: string, responseNumber: string) {
    const bid = await this.prisma.portalBid.findFirst({
      where: { businessId, portalCode, responseNumber },
      select: { tenderId: true, status: true, tender: { select: { tenderNumber: true } } },
    });
    return bid ? { tenderId: bid.tenderId, tenderNumber: bid.tender.tenderNumber, status: bid.status } : null;
  }
}

export class PortalProfileRepository implements IPortalProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAnswers(businessId: string, portalCode: string): Promise<Record<string, string>> {
    const row = await this.prisma.portalProfile.findFirst({ where: { businessId, portalCode } });
    return (row?.answers as Record<string, string> | undefined) ?? {};
  }

  async saveAnswers(businessId: string, portalCode: string, answers: Record<string, string>): Promise<void> {
    await this.prisma.portalProfile.upsert({
      where: { businessId_portalCode: { businessId, portalCode } },
      create: { businessId, portalCode, answers },
      update: { answers },
    });
  }
}
