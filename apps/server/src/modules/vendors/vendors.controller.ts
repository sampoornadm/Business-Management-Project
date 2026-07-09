import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";

import type { VendorsService } from "./vendors.service.js";
import type {
  CreateContactBody,
  CreateVendorBody,
  CreateVendorItemTagBody,
  ListVendorsQuery,
  UpdateContactBody,
  UpdateVendorBody,
} from "./vendors.validation.js";

export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListVendorsQuery;
    const pagination = resolvePagination(query);
    const result = await this.vendorsService.listVendors(pagination, {
      search: query.search,
      category: query.category,
      isActive: query.isActive,
    });
    sendSuccess(res, result, "Vendors retrieved");
  });

  getById = asyncHandler(async (req, res) => {
    const vendor = await this.vendorsService.getById(req.params.id!);
    sendSuccess(res, vendor, "Vendor retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateVendorBody;
    const vendor = await this.vendorsService.create(
      { ...body, createdById: req.user!.id },
      { ipAddress: req.ip, userAgent: req.headers["user-agent"] },
    );
    sendSuccess(res, vendor, "Vendor created", 201);
  });

  update = asyncHandler(async (req, res) => {
    const body = req.body as UpdateVendorBody;
    const vendor = await this.vendorsService.update(req.params.id!, body, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, vendor, "Vendor updated");
  });

  deleteById = asyncHandler(async (req, res) => {
    await this.vendorsService.delete(req.params.id!, req.user!.id, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, null, "Vendor deleted");
  });

  addContact = asyncHandler(async (req, res) => {
    const body = req.body as CreateContactBody;
    const vendor = await this.vendorsService.addContact(req.params.id!, body, req.user!.id);
    sendSuccess(res, vendor, "Contact added", 201);
  });

  updateContact = asyncHandler(async (req, res) => {
    const body = req.body as UpdateContactBody;
    const vendor = await this.vendorsService.updateContact(
      req.params.id!,
      req.params.contactId!,
      body,
      req.user!.id,
    );
    sendSuccess(res, vendor, "Contact updated");
  });

  deleteContact = asyncHandler(async (req, res) => {
    const vendor = await this.vendorsService.deleteContact(
      req.params.id!,
      req.params.contactId!,
      req.user!.id,
    );
    sendSuccess(res, vendor, "Contact deleted");
  });

  getPerformance = asyncHandler(async (req, res) => {
    const performance = await this.vendorsService.getPerformance(req.params.id!);
    sendSuccess(res, performance, "Vendor performance retrieved");
  });

  addItemTag = asyncHandler(async (req, res) => {
    const body = req.body as CreateVendorItemTagBody;
    const vendor = await this.vendorsService.addItemTag(req.params.id!, body, req.user!.id);
    sendSuccess(res, vendor, "Item tag added", 201);
  });

  deleteItemTag = asyncHandler(async (req, res) => {
    const vendor = await this.vendorsService.removeItemTag(req.params.id!, req.params.tagId!, req.user!.id);
    sendSuccess(res, vendor, "Item tag removed");
  });

  importItemTags = asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("No file provided");
    const result = await this.vendorsService.importItemTags(req.file.buffer, req.user!.id);
    sendSuccess(res, result, "Item tags imported");
  });
}
