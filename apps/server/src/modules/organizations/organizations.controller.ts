import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";
import { exportTableToCsv, exportTableToXlsx } from "../../shared/utils/table-export.js";

import { buildOrganizationExportTable, ORGANIZATION_EXPORT_COLUMN_KEYS } from "./organizations.mapper.js";
import type { OrganizationsService } from "./organizations.service.js";
import type {
  CreateContactBody,
  CreateOrganizationBody,
  ExportOrganizationsQuery,
  ListOrganizationsQuery,
  UpdateContactBody,
  UpdateOrganizationBody,
} from "./organizations.validation.js";

export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListOrganizationsQuery;
    const pagination = resolvePagination(query);
    const result = await this.organizationsService.listOrganizations(pagination, { ...query });
    sendSuccess(res, result, "Organizations retrieved");
  });

  exportOrganizations = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ExportOrganizationsQuery;
    const pagination = resolvePagination(query);
    const items = await this.organizationsService.exportOrganizations({ ...query }, query.scope, pagination);

    const columnKeys = query.columns ?? ORGANIZATION_EXPORT_COLUMN_KEYS;
    const table = buildOrganizationExportTable(items, columnKeys);
    const date = new Date().toISOString().slice(0, 10);

    if (query.format === "xlsx") {
      const buffer = await exportTableToXlsx(table);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="organizations-export-${date}.xlsx"`);
      res.send(buffer);
      return;
    }

    const buffer = exportTableToCsv(table);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="organizations-export-${date}.csv"`);
    res.send(buffer);
  });

  getById = asyncHandler(async (req, res) => {
    const organization = await this.organizationsService.getById(req.params.id!);
    sendSuccess(res, organization, "Organization retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateOrganizationBody;
    const organization = await this.organizationsService.create(
      { ...body, createdById: req.user!.id },
      { ipAddress: req.ip, userAgent: req.headers["user-agent"] },
    );
    sendSuccess(res, organization, "Organization created", 201);
  });

  update = asyncHandler(async (req, res) => {
    const body = req.body as UpdateOrganizationBody;
    const organization = await this.organizationsService.update(req.params.id!, body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, organization, "Organization updated");
  });

  deleteById = asyncHandler(async (req, res) => {
    await this.organizationsService.delete(req.params.id!, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, null, "Organization deleted");
  });

  addContact = asyncHandler(async (req, res) => {
    const body = req.body as CreateContactBody;
    const organization = await this.organizationsService.addContact(
      req.params.id!,
      body,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, organization, "Contact added", 201);
  });

  updateContact = asyncHandler(async (req, res) => {
    const body = req.body as UpdateContactBody;
    const organization = await this.organizationsService.updateContact(
      req.params.id!,
      req.params.contactId!,
      body,
      req.user!.id,
      req.user!.businessId,
    );
    sendSuccess(res, organization, "Contact updated");
  });

  deleteContact = asyncHandler(async (req, res) => {
    const organization = await this.organizationsService.deleteContact(
      req.params.id!,
      req.params.contactId!,
      req.user!.id,
    );
    sendSuccess(res, organization, "Contact deleted");
  });
}
