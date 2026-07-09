import type {
  TenderAssigneeDto,
  TenderCompetitorDto,
  TenderDto,
  TenderListItemDto,
  TenderTagDto,
} from "@bmp/types";

import type {
  TenderAssigneeWithRelations,
  TenderDetail,
  TenderListItem,
} from "./tenders.repository.js";

export function toTenderListItemDto(entity: TenderListItem): TenderListItemDto {
  return {
    id: entity.id,
    tenderNumber: entity.tenderNumber,
    title: entity.title,
    department: entity.department,
    client: { id: entity.client.id, name: entity.client.name, type: entity.client.type },
    type: entity.type,
    category: entity.category,
    status: entity.status,
    priority: entity.priority,
    estimatedCost: entity.estimatedCost,
    submissionDate: entity.submissionDate.toISOString(),
    assigneeCount: entity._count.assignees,
    createdAt: entity.createdAt.toISOString(),
  };
}

function toAssigneeDto(entity: TenderAssigneeWithRelations): TenderAssigneeDto {
  return {
    id: entity.id,
    role: entity.role,
    user: {
      id: entity.user.id,
      firstName: entity.user.firstName,
      lastName: entity.user.lastName,
      email: entity.user.email,
    },
    assignedBy: {
      id: entity.assignedBy.id,
      firstName: entity.assignedBy.firstName,
      lastName: entity.assignedBy.lastName,
    },
    createdAt: entity.createdAt.toISOString(),
  };
}

function toCompetitorDto(entity: TenderDetail["competitors"][number]): TenderCompetitorDto {
  return {
    id: entity.id,
    competitorName: entity.competitorName,
    bidAmount: entity.bidAmount,
    isWinningBid: entity.isWinningBid,
    remarks: entity.remarks,
    createdAt: entity.createdAt.toISOString(),
  };
}

function toTagDto(entity: TenderDetail["tags"][number]): TenderTagDto {
  return { id: entity.tag.id, name: entity.tag.name, color: entity.tag.color };
}

export function toTenderDto(entity: TenderDetail): TenderDto {
  return {
    id: entity.id,
    tenderNumber: entity.tenderNumber,
    title: entity.title,
    department: entity.department,
    client: { id: entity.client.id, name: entity.client.name, type: entity.client.type },
    type: entity.type,
    category: entity.category,
    location: entity.location,
    state: entity.state,
    status: entity.status,
    priority: entity.priority,
    estimatedCost: entity.estimatedCost,
    emdAmount: entity.emdAmount,
    tenderFee: entity.tenderFee,
    documentFee: entity.documentFee,
    submissionDate: entity.submissionDate.toISOString(),
    openingDate: entity.openingDate ? entity.openingDate.toISOString() : null,
    validityPeriodDays: entity.validityPeriodDays,
    statusChangedAt: entity.statusChangedAt.toISOString(),
    description: entity.description,
    remarks: entity.remarks,
    dealingOfficerName: entity.dealingOfficerName,
    dealingOfficerEmail: entity.dealingOfficerEmail,
    dealingOfficerPhone: entity.dealingOfficerPhone,
    winnerName: entity.winnerName,
    winningBidAmount: entity.winningBidAmount,
    lossReason: entity.lossReason,
    createdBy: {
      id: entity.createdBy.id,
      firstName: entity.createdBy.firstName,
      lastName: entity.createdBy.lastName,
    },
    assignees: entity.assignees.map(toAssigneeDto),
    assigneeCount: entity.assignees.length,
    competitors: entity.competitors.map(toCompetitorDto),
    tags: entity.tags.map(toTagDto),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}
