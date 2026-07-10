import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";

import type { BusinessesService } from "./businesses.service.js";
import type {
  AddMemberBody,
  CreateBusinessBody,
  CreateContactBody,
  ListBusinessesQuery,
  UpdateBusinessBody,
  UpdateContactBody,
  UpdateMemberBody,
} from "./businesses.validation.js";

export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListBusinessesQuery;
    const pagination = resolvePagination(query);
    const result = await this.businessesService.listBusinesses(pagination, {
      search: query.search,
      isActive: query.isActive,
    });
    sendSuccess(res, result, "Businesses retrieved");
  });

  getById = asyncHandler(async (req, res) => {
    const business = await this.businessesService.getById(req.params.id!);
    sendSuccess(res, business, "Business retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateBusinessBody;
    const business = await this.businessesService.create(body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, business, "Business created", 201);
  });

  update = asyncHandler(async (req, res) => {
    const body = req.body as UpdateBusinessBody;
    const business = await this.businessesService.update(req.params.id!, body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, business, "Business updated");
  });

  deleteById = asyncHandler(async (req, res) => {
    await this.businessesService.delete(req.params.id!, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, null, "Business deleted");
  });

  addContact = asyncHandler(async (req, res) => {
    const body = req.body as CreateContactBody;
    const business = await this.businessesService.addContact(req.params.id!, body);
    sendSuccess(res, business, "Contact added", 201);
  });

  updateContact = asyncHandler(async (req, res) => {
    const body = req.body as UpdateContactBody;
    const business = await this.businessesService.updateContact(req.params.id!, req.params.contactId!, body);
    sendSuccess(res, business, "Contact updated");
  });

  deleteContact = asyncHandler(async (req, res) => {
    const business = await this.businessesService.deleteContact(req.params.id!, req.params.contactId!);
    sendSuccess(res, business, "Contact deleted");
  });

  listMembers = asyncHandler(async (req, res) => {
    const members = await this.businessesService.listMembers(req.params.id!);
    sendSuccess(res, members, "Members retrieved");
  });

  addMember = asyncHandler(async (req, res) => {
    const body = req.body as AddMemberBody;
    await this.businessesService.addMember(req.params.id!, body.userId, body.roleId, req.user!.id);
    sendSuccess(res, null, "Member added", 201);
  });

  updateMember = asyncHandler(async (req, res) => {
    const body = req.body as UpdateMemberBody;
    await this.businessesService.updateMemberRole(req.params.id!, req.params.userId!, body.roleId, req.user!.id);
    sendSuccess(res, null, "Member role updated");
  });

  removeMember = asyncHandler(async (req, res) => {
    await this.businessesService.removeMember(req.params.id!, req.params.userId!, req.user!.id);
    sendSuccess(res, null, "Member removed");
  });
}
