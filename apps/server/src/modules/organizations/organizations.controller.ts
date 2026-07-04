import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";

import type { OrganizationsService } from "./organizations.service.js";
import type {
  CreateContactBody,
  CreateOrganizationBody,
  ListOrganizationsQuery,
  UpdateContactBody,
  UpdateOrganizationBody,
} from "./organizations.validation.js";

export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListOrganizationsQuery;
    const pagination = resolvePagination(query);
    const result = await this.organizationsService.listOrganizations(pagination, {
      search: query.search,
      type: query.type,
    });
    sendSuccess(res, result, "Organizations retrieved");
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
    const organization = await this.organizationsService.addContact(req.params.id!, body, req.user!.id);
    sendSuccess(res, organization, "Contact added", 201);
  });

  updateContact = asyncHandler(async (req, res) => {
    const body = req.body as UpdateContactBody;
    const organization = await this.organizationsService.updateContact(
      req.params.id!,
      req.params.contactId!,
      body,
      req.user!.id,
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
