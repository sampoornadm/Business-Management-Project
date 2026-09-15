import type {
  ProjectBillDto,
  ProjectDto,
  ProjectLaborEntryDto,
  ProjectListItemDto,
  ProjectMaterialUsageDto,
  ProjectMilestoneDto,
} from "@bmp/types";

import type { ExportableTable } from "../../shared/utils/table-export.js";

import type {
  BillWithCreator,
  LaborEntryWithRecorder,
  MaterialUsageWithRecorder,
  ProjectDetail,
} from "./projects.repository.js";

function toMilestoneDto(entity: ProjectDetail["milestones"][number]): ProjectMilestoneDto {
  return {
    id: entity.id,
    title: entity.title,
    plannedDate: entity.plannedDate ? entity.plannedDate.toISOString() : null,
    completedDate: entity.completedDate ? entity.completedDate.toISOString() : null,
    status: entity.status,
    weightPercent: entity.weightPercent,
    sortOrder: entity.sortOrder,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toProjectListItemDto(entity: ProjectDetail): ProjectListItemDto {
  return {
    id: entity.id,
    tenderId: entity.tenderId,
    name: entity.name,
    status: entity.status,
    budget: entity.budget,
    startDate: entity.startDate.toISOString(),
    endDate: entity.endDate ? entity.endDate.toISOString() : null,
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toProjectDto(entity: ProjectDetail): ProjectDto {
  return {
    ...toProjectListItemDto(entity),
    actualEndDate: entity.actualEndDate ? entity.actualEndDate.toISOString() : null,
    location: entity.location,
    notes: entity.notes,
    milestones: entity.milestones.map(toMilestoneDto),
    createdBy: {
      id: entity.createdBy.id,
      firstName: entity.createdBy.firstName,
      lastName: entity.createdBy.lastName,
    },
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export function toMaterialUsageDto(entity: MaterialUsageWithRecorder): ProjectMaterialUsageDto {
  return {
    id: entity.id,
    boqItemId: entity.boqItemId,
    materialName: entity.materialName,
    unit: entity.unit,
    quantityUsed: entity.quantityUsed,
    usageDate: entity.usageDate.toISOString(),
    remarks: entity.remarks,
    recordedBy: {
      id: entity.recordedBy.id,
      firstName: entity.recordedBy.firstName,
      lastName: entity.recordedBy.lastName,
    },
    createdAt: entity.createdAt.toISOString(),
  };
}

export function toLaborEntryDto(entity: LaborEntryWithRecorder): ProjectLaborEntryDto {
  return {
    id: entity.id,
    category: entity.category,
    description: entity.description,
    workerCount: entity.workerCount,
    units: entity.units,
    ratePerUnit: entity.ratePerUnit,
    amount: entity.amount,
    entryDate: entity.entryDate.toISOString(),
    remarks: entity.remarks,
    recordedBy: {
      id: entity.recordedBy.id,
      firstName: entity.recordedBy.firstName,
      lastName: entity.recordedBy.lastName,
    },
    createdAt: entity.createdAt.toISOString(),
  };
}

// Keep this in exact sync with apps/web/src/components/projects/project-column-registry.tsx's
// PROJECT_COLUMNS keys — every column a user can show via ColumnPicker must be exportable, or
// showing it and then exporting silently drops it from the file.
const PROJECT_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: "name", header: "Name" },
  { key: "status", header: "Status" },
  { key: "budget", header: "Budget" },
  { key: "startDate", header: "Start Date" },
  { key: "endDate", header: "Planned End" },
];

function projectExportRow(project: ProjectListItemDto): Record<string, string | number> {
  return {
    name: project.name,
    status: project.status,
    budget: project.budget,
    startDate: project.startDate.slice(0, 10),
    endDate: project.endDate ? project.endDate.slice(0, 10) : "",
  };
}

export function buildProjectExportTable(projects: ProjectListItemDto[], columnKeys: string[]): ExportableTable {
  const columnsByKey = new Map(PROJECT_EXPORT_COLUMNS.map((column) => [column.key, column]));
  const columns = columnKeys
    .map((key) => columnsByKey.get(key))
    .filter((column): column is { key: string; header: string } => Boolean(column));
  const rows = projects.map((project) => {
    const fullRow = projectExportRow(project);
    const row: Record<string, string | number> = {};
    for (const column of columns) row[column.key] = fullRow[column.key] ?? "";
    return row;
  });
  return { title: "Projects", columns, rows };
}

export const PROJECT_EXPORT_COLUMN_KEYS = PROJECT_EXPORT_COLUMNS.map((column) => column.key);

export function toBillDto(entity: BillWithCreator): ProjectBillDto {
  return {
    id: entity.id,
    billNumber: entity.billNumber,
    billDate: entity.billDate.toISOString(),
    cumulativeAmount: entity.cumulativeAmount,
    currentBillAmount: entity.currentBillAmount,
    status: entity.status,
    remarks: entity.remarks,
    createdBy: {
      id: entity.createdBy.id,
      firstName: entity.createdBy.firstName,
      lastName: entity.createdBy.lastName,
    },
    createdAt: entity.createdAt.toISOString(),
  };
}
