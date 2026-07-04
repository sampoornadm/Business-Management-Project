import {
  TENDER_STATUS_TRANSITIONS,
  type AttachmentDto,
  type PaginatedResult,
  type TenderDashboardStatsDto,
  type TenderDto,
  type TenderListItemDto,
  type TenderStatus,
  type TenderStatusHistoryEntryDto,
} from "@bmp/types";

import { GENERIC_UPLOAD_LIMITS } from "../../config/constants.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";
import type { EmailService } from "../../infra/mailer/email.service.js";
import { toAttachmentDto } from "../attachments/attachments.mapper.js";
import type { AttachmentsService } from "../attachments/attachments.service.js";
import type { AuditService } from "../audit/audit.service.js";
import type { NotificationsService } from "../notifications/notifications.service.js";
import type { IOrganizationsRepository } from "../organizations/organizations.repository.js";
import type { ITagsRepository } from "../tags/tags.repository.js";
import type { IUsersRepository } from "../users/users.repository.js";

import { toTenderDto, toTenderListItemDto } from "./tenders.mapper.js";
import type {
  CreateCompetitorData,
  CreateTenderData,
  ITendersRepository,
  TenderFilters,
  UpdateCompetitorData,
  UpdateTenderData,
} from "./tenders.repository.js";
import type {
  AddAssigneeBody,
  ChangeTenderStatusBody,
} from "./tenders.validation.js";

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export class TendersService {
  constructor(
    private readonly tendersRepository: ITendersRepository,
    private readonly organizationsRepository: IOrganizationsRepository,
    private readonly usersRepository: IUsersRepository,
    private readonly tagsRepository: ITagsRepository,
    private readonly auditService: AuditService,
    private readonly attachmentsService: AttachmentsService,
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {}

  async listTenders(
    pagination: PaginationParams,
    filters: TenderFilters,
  ): Promise<PaginatedResult<TenderListItemDto>> {
    const { items, totalItems } = await this.tendersRepository.findMany(pagination, filters);
    return buildPaginatedResult(items.map(toTenderListItemDto), totalItems, pagination);
  }

  async getById(id: string): Promise<TenderDto> {
    const tender = await this.tendersRepository.findById(id);
    if (!tender) throw new NotFoundError("Tender not found");
    return toTenderDto(tender);
  }

  private async assertTenderExists(id: string) {
    const tender = await this.tendersRepository.findById(id);
    if (!tender) throw new NotFoundError("Tender not found");
    return tender;
  }

  async create(
    data: CreateTenderData,
    context: RequestContext = {},
  ): Promise<TenderDto> {
    const duplicate = await this.tendersRepository.findByTenderNumber(data.tenderNumber);
    if (duplicate) throw new ConflictError("A tender with this tender number already exists");

    const client = await this.organizationsRepository.findById(data.clientId);
    if (!client) throw new BadRequestError("Invalid client");

    const tender = await this.tendersRepository.create(data);
    await this.auditService.log({
      actorId: data.createdById,
      action: "TENDER_CREATED",
      entityType: "Tender",
      entityId: tender.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return toTenderDto(tender);
  }

  async update(
    id: string,
    data: UpdateTenderData,
    actorId: string,
    context: RequestContext = {},
  ): Promise<TenderDto> {
    await this.assertTenderExists(id);

    if (data.clientId) {
      const client = await this.organizationsRepository.findById(data.clientId);
      if (!client) throw new BadRequestError("Invalid client");
    }

    const tender = await this.tendersRepository.update(id, data);
    await this.auditService.log({
      actorId,
      action: "TENDER_UPDATED",
      entityType: "Tender",
      entityId: id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return toTenderDto(tender);
  }

  async delete(id: string, actorId: string, context: RequestContext = {}): Promise<void> {
    const tender = await this.assertTenderExists(id);
    if (tender.status !== "DRAFT") {
      throw new ConflictError("Only tenders in Draft status can be deleted");
    }
    await this.tendersRepository.delete(id);
    await this.auditService.log({
      actorId,
      action: "TENDER_DELETED",
      entityType: "Tender",
      entityId: id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  async changeStatus(
    id: string,
    input: ChangeTenderStatusBody,
    actorId: string,
    context: RequestContext = {},
  ): Promise<TenderDto> {
    const tender = await this.assertTenderExists(id);
    // Captured before the repository call: the repository may return the
    // same mutated object reference rather than a fresh copy (as some
    // fakes/caches do), so this must not be re-read from `tender` afterward.
    const previousStatus = tender.status as TenderStatus;
    const allowedNext = TENDER_STATUS_TRANSITIONS[previousStatus];
    if (!allowedNext.includes(input.status)) {
      throw new BadRequestError(
        `Cannot transition from ${previousStatus} to ${input.status}. Allowed: ${allowedNext.join(", ") || "none"}`,
      );
    }

    const updated = await this.tendersRepository.updateStatus(id, {
      status: input.status,
      statusChangedAt: new Date(),
      winnerName: input.winnerName,
      winningBidAmount: input.winningBidAmount,
      lossReason: input.lossReason,
    });

    await this.auditService.log({
      actorId,
      action: "TENDER_STATUS_CHANGED",
      entityType: "Tender",
      entityId: id,
      metadata: { from: previousStatus, to: input.status, remarks: input.remarks ?? null },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const recipientIds = new Set(updated.assignees.map((a) => a.user.id));
    recipientIds.add(updated.createdBy.id);
    recipientIds.delete(actorId);

    if (recipientIds.size > 0) {
      await this.notificationsService.createMany([...recipientIds], {
        type: "TENDER_STATUS_CHANGED",
        title: `Tender ${updated.tenderNumber} status changed to ${input.status}`,
        body: updated.title,
        entityType: "Tender",
        entityId: id,
        metadata: { from: previousStatus, to: input.status },
      });
    }

    return toTenderDto(updated);
  }

  async getStatusHistory(
    id: string,
    pagination: PaginationParams,
  ): Promise<PaginatedResult<TenderStatusHistoryEntryDto>> {
    await this.assertTenderExists(id);
    const result = await this.auditService.list(pagination, {
      entityType: "Tender",
      entityId: id,
      action: "TENDER_STATUS_CHANGED",
    });

    const items: TenderStatusHistoryEntryDto[] = result.items.map((log) => {
      const metadata = (log.metadata ?? {}) as { from?: TenderStatus; to?: TenderStatus; remarks?: string };
      return {
        id: log.id,
        fromStatus: metadata.from ?? null,
        toStatus: (metadata.to ?? "DRAFT") as TenderStatus,
        remarks: metadata.remarks ?? null,
        changedBy: log.actor
          ? { id: log.actor.id, firstName: log.actor.firstName, lastName: log.actor.lastName }
          : null,
        changedAt: log.createdAt,
      };
    });

    return { ...result, items };
  }

  async addAssignee(tenderId: string, input: AddAssigneeBody, actorId: string): Promise<TenderDto> {
    const tender = await this.assertTenderExists(tenderId);

    const user = await this.usersRepository.findById(input.userId);
    if (!user) throw new BadRequestError("Invalid user");

    const existing = await this.tendersRepository.findAssignee(tenderId, input.userId);
    if (existing) throw new ConflictError("This user is already assigned to the tender");

    await this.tendersRepository.addAssignee(tenderId, input.userId, input.role ?? "OTHER", actorId);

    await this.notificationsService.create({
      userId: input.userId,
      type: "TENDER_ASSIGNED",
      title: `You were assigned to tender ${tender.tenderNumber}`,
      body: tender.title,
      entityType: "Tender",
      entityId: tenderId,
    });
    await this.emailService.queueTenderAssignedEmail({
      to: user.email,
      firstName: user.firstName,
      tenderId,
      tenderNumber: tender.tenderNumber,
      tenderTitle: tender.title,
    });

    await this.auditService.log({
      actorId,
      action: "TENDER_ASSIGNED",
      entityType: "Tender",
      entityId: tenderId,
      metadata: { userId: input.userId, role: input.role ?? "OTHER" },
    });

    return this.getById(tenderId);
  }

  async removeAssignee(tenderId: string, userId: string, actorId: string): Promise<TenderDto> {
    await this.assertTenderExists(tenderId);
    const existing = await this.tendersRepository.findAssignee(tenderId, userId);
    if (!existing) throw new NotFoundError("Assignee not found for this tender");

    await this.tendersRepository.removeAssignee(tenderId, userId);
    await this.auditService.log({
      actorId,
      action: "TENDER_UNASSIGNED",
      entityType: "Tender",
      entityId: tenderId,
      metadata: { userId },
    });

    return this.getById(tenderId);
  }

  async addCompetitor(
    tenderId: string,
    data: CreateCompetitorData,
    actorId: string,
  ): Promise<TenderDto> {
    await this.assertTenderExists(tenderId);
    await this.tendersRepository.addCompetitor(tenderId, data);
    await this.auditService.log({
      actorId,
      action: "TENDER_COMPETITOR_ADDED",
      entityType: "Tender",
      entityId: tenderId,
    });
    return this.getById(tenderId);
  }

  private async assertCompetitorBelongsToTender(tenderId: string, competitorId: string) {
    const competitor = await this.tendersRepository.findCompetitorById(competitorId);
    if (!competitor || competitor.tenderId !== tenderId) {
      throw new NotFoundError("Competitor not found for this tender");
    }
  }

  async updateCompetitor(
    tenderId: string,
    competitorId: string,
    data: UpdateCompetitorData,
    actorId: string,
  ): Promise<TenderDto> {
    await this.assertCompetitorBelongsToTender(tenderId, competitorId);
    await this.tendersRepository.updateCompetitor(competitorId, data);
    await this.auditService.log({
      actorId,
      action: "TENDER_COMPETITOR_UPDATED",
      entityType: "Tender",
      entityId: tenderId,
    });
    return this.getById(tenderId);
  }

  async deleteCompetitor(tenderId: string, competitorId: string, actorId: string): Promise<TenderDto> {
    await this.assertCompetitorBelongsToTender(tenderId, competitorId);
    await this.tendersRepository.deleteCompetitor(competitorId);
    await this.auditService.log({
      actorId,
      action: "TENDER_COMPETITOR_DELETED",
      entityType: "Tender",
      entityId: tenderId,
    });
    return this.getById(tenderId);
  }

  async setTags(tenderId: string, tagIds: string[], actorId: string): Promise<TenderDto> {
    await this.assertTenderExists(tenderId);

    for (const tagId of tagIds) {
      const tag = await this.tagsRepository.findById(tagId);
      if (!tag) throw new BadRequestError(`Invalid tag: ${tagId}`);
    }

    await this.tendersRepository.setTags(tenderId, tagIds);
    await this.auditService.log({
      actorId,
      action: "TENDER_TAGS_UPDATED",
      entityType: "Tender",
      entityId: tenderId,
      metadata: { tagIds },
    });
    return this.getById(tenderId);
  }

  async uploadDocument(
    tenderId: string,
    file: { buffer: Buffer; originalName: string; mimeType: string },
    documentType: string,
    replacesAttachmentId: string | undefined,
    actorId: string,
  ): Promise<AttachmentDto> {
    await this.assertTenderExists(tenderId);

    const { original } = await this.attachmentsService.upload({
      fileBuffer: file.buffer,
      originalName: file.originalName,
      declaredMimeType: file.mimeType,
      entityType: "Tender",
      entityId: tenderId,
      uploadedById: actorId,
      allowedMimeTypes: GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES,
      maxSizeBytes: GENERIC_UPLOAD_LIMITS.MAX_SIZE_BYTES,
      generateImageVariants: false,
      documentType,
      replacesAttachmentId,
    });

    await this.auditService.log({
      actorId,
      action: "TENDER_DOCUMENT_UPLOADED",
      entityType: "Tender",
      entityId: tenderId,
      metadata: { documentType, attachmentId: original.id, version: original.version },
    });

    return toAttachmentDto(original);
  }

  async listDocuments(tenderId: string, documentType?: string): Promise<AttachmentDto[]> {
    await this.assertTenderExists(tenderId);
    const attachments = await this.attachmentsService.listByEntity("Tender", tenderId, documentType);
    return Promise.all(attachments.map(toAttachmentDto));
  }

  async listDocumentVersions(tenderId: string, documentGroupId: string): Promise<AttachmentDto[]> {
    await this.assertTenderExists(tenderId);
    const versions = await this.attachmentsService.listVersions(documentGroupId);
    const belongsToTender = versions.every((v) => v.entityType === "Tender" && v.entityId === tenderId);
    if (versions.length > 0 && !belongsToTender) {
      throw new NotFoundError("Document group not found for this tender");
    }
    return Promise.all(versions.map(toAttachmentDto));
  }

  async getDashboardStats(): Promise<TenderDashboardStatsDto> {
    const [statusCounts, upcoming] = await Promise.all([
      this.tendersRepository.countByStatus(),
      this.tendersRepository.findUpcomingDeadlines(7),
    ]);

    const byStatus: Partial<Record<TenderStatus, number>> = {};
    let totalActive = 0;
    for (const { status, count } of statusCounts) {
      byStatus[status] = count;
      if (!["WON", "LOST", "CANCELLED", "ARCHIVED"].includes(status)) {
        totalActive += count;
      }
    }

    return {
      totalActive,
      byStatus,
      pendingApprovalCount: byStatus.APPROVAL_PENDING ?? 0,
      upcomingDeadlines: upcoming.map(toTenderListItemDto),
    };
  }
}
