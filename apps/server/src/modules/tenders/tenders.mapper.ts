import type {
  TenderAssigneeDto,
  TenderCompetitorDto,
  TenderDto,
  TenderListItemDto,
  TenderPinnedNoteDto,
  TenderTagDto,
} from "@bmp/types";

import type { ExportableTable } from "../../shared/utils/table-export.js";

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
    kind: entity.kind,
    estimatedCost: entity.estimatedCost,
    submissionDate: entity.submissionDate ? entity.submissionDate.toISOString() : null,
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

function toPinnedNoteDto(entity: TenderDetail["pinnedNotes"][number]): TenderPinnedNoteDto {
  return { id: entity.id, lineText: entity.lineText };
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
    kind: entity.kind,
    estimatedCost: entity.estimatedCost,
    emdAmount: entity.emdAmount,
    tenderFee: entity.tenderFee,
    documentFee: entity.documentFee,
    submissionDate: entity.submissionDate ? entity.submissionDate.toISOString() : null,
    openingDate: entity.openingDate ? entity.openingDate.toISOString() : null,
    validityPeriodDays: entity.validityPeriodDays,
    statusChangedAt: entity.statusChangedAt.toISOString(),
    description: entity.description,
    remarks: entity.remarks,
    notes: entity.notes,
    dealingOfficerName: entity.dealingOfficerName,
    dealingOfficerEmail: entity.dealingOfficerEmail,
    dealingOfficerPhone: entity.dealingOfficerPhone,
    winnerName: entity.winnerName,
    winningBidAmount: entity.winningBidAmount,
    lossReason: entity.lossReason,
    convertedFrom: entity.convertedFrom
      ? {
          id: entity.convertedFrom.id,
          tenderNumber: entity.convertedFrom.tenderNumber,
          title: entity.convertedFrom.title,
          updatedAt: entity.convertedFrom.updatedAt.toISOString(),
        }
      : null,
    createdBy: {
      id: entity.createdBy.id,
      firstName: entity.createdBy.firstName,
      lastName: entity.createdBy.lastName,
    },
    assignees: entity.assignees.map(toAssigneeDto),
    assigneeCount: entity.assignees.length,
    competitors: entity.competitors.map(toCompetitorDto),
    pinnedNotes: entity.pinnedNotes.map(toPinnedNoteDto),
    tags: entity.tags.map(toTagDto),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

// Keep this in exact sync with apps/web/src/components/tenders/tender-column-registry.ts's
// TENDER_COLUMNS keys — every column a user can show via ColumnPicker must be exportable, or
// showing it and then exporting silently drops it from the file.
const TENDER_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: "tenderNumber", header: "Tender #" },
  { key: "title", header: "Title" },
  { key: "clientName", header: "Client" },
  { key: "status", header: "Status" },
  { key: "priority", header: "Priority" },
  { key: "department", header: "Department" },
  { key: "submissionDate", header: "Submission Date" },
  { key: "assigneeCount", header: "Assignees" },
];

function tenderExportRow(tender: TenderListItemDto): Record<string, string | number> {
  return {
    tenderNumber: tender.tenderNumber,
    title: tender.title,
    clientName: tender.client.name,
    status: tender.status,
    priority: tender.priority,
    department: tender.department ?? "",
    submissionDate: tender.submissionDate ? tender.submissionDate.slice(0, 10) : "",
    assigneeCount: tender.assigneeCount,
  };
}

export function buildTenderExportTable(tenders: TenderListItemDto[], columnKeys: string[]): ExportableTable {
  const columnsByKey = new Map(TENDER_EXPORT_COLUMNS.map((column) => [column.key, column]));
  const columns = columnKeys
    .map((key) => columnsByKey.get(key))
    .filter((column): column is { key: string; header: string } => Boolean(column));
  const rows = tenders.map((tender) => {
    const fullRow = tenderExportRow(tender);
    const row: Record<string, string | number> = {};
    for (const column of columns) row[column.key] = fullRow[column.key] ?? "";
    return row;
  });
  return { title: "Tenders", columns, rows };
}

export const TENDER_EXPORT_COLUMN_KEYS = TENDER_EXPORT_COLUMNS.map((column) => column.key);
