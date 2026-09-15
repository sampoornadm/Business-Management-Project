import { BadRequestError } from "../../core/errors/HttpErrors.js";
import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";
import { exportTableToCsv, exportTableToXlsx } from "../../shared/utils/table-export.js";

import { buildUserExportTable, USER_EXPORT_COLUMN_KEYS } from "./users.mapper.js";
import type { UsersService } from "./users.service.js";
import type {
  AssignRoleBody,
  CreateUserBody,
  ExportUsersQueryParsed,
  ListUsersQuery,
  UpdateOwnProfileBody,
  UpdateThemeColorBody,
  UpdateUserBody,
} from "./users.validation.js";

export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListUsersQuery;
    const pagination = resolvePagination(query);
    const result = await this.usersService.listUsers(pagination, {
      businessId: req.user!.businessId,
      search: query.search,
      roleId: query.roleId,
      isActive: query.isActive,
      filters: query.filters,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
    sendSuccess(res, result, "Users retrieved");
  });

  exportUsers = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ExportUsersQueryParsed;
    const pagination = resolvePagination(query);
    const users = await this.usersService.exportUsers(
      {
        businessId: req.user!.businessId,
        search: query.search,
        roleId: query.roleId,
        isActive: query.isActive,
        filters: query.filters,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      },
      query.scope,
      pagination,
    );

    const columnKeys = query.columns ?? USER_EXPORT_COLUMN_KEYS;
    const table = buildUserExportTable(users, columnKeys);
    const date = new Date().toISOString().slice(0, 10);

    if (query.format === "xlsx") {
      const buffer = await exportTableToXlsx(table);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="users-export-${date}.xlsx"`);
      res.send(buffer);
      return;
    }

    const buffer = exportTableToCsv(table);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="users-export-${date}.csv"`);
    res.send(buffer);
  });

  getById = asyncHandler(async (req, res) => {
    const user = await this.usersService.getById(req.params.id!, req.user!.businessId);
    sendSuccess(res, user, "User retrieved");
  });

  getMe = asyncHandler(async (req, res) => {
    const user = await this.usersService.getById(req.user!.id, req.user!.businessId);
    sendSuccess(res, user, "Current user retrieved");
  });

  create = asyncHandler(async (req, res) => {
    const body = req.body as CreateUserBody;
    const user = await this.usersService.createUser(body, req.user!.id, req.user!.businessId, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, user, "User created", 201);
  });

  update = asyncHandler(async (req, res) => {
    const body = req.body as UpdateUserBody;
    const user = await this.usersService.updateUser(
      req.params.id!,
      body,
      req.user!.id,
      req.user!.businessId,
      {
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      },
    );
    sendSuccess(res, user, "User updated");
  });

  updateMe = asyncHandler(async (req, res) => {
    const body = req.body as UpdateOwnProfileBody;
    const user = await this.usersService.updateOwnProfile(req.user!.id, body, req.user!.businessId);
    sendSuccess(res, user, "Profile updated");
  });

  updateThemeColor = asyncHandler(async (req, res) => {
    const body = req.body as UpdateThemeColorBody;
    const user = await this.usersService.updateThemeColor(req.user!.id, body.businessId, body.themeColor);
    sendSuccess(res, user, "Theme color updated");
  });

  assignRole = asyncHandler(async (req, res) => {
    const body = req.body as AssignRoleBody;
    const user = await this.usersService.assignRole(
      req.params.id!,
      body.roleId,
      req.user!.id,
      req.user!.businessId,
      {
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      },
    );
    sendSuccess(res, user, "Role assigned");
  });

  deactivate = asyncHandler(async (req, res) => {
    const user = await this.usersService.deactivateUser(req.params.id!, req.user!.id, req.user!.businessId, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
    sendSuccess(res, user, "User deactivated");
  });

  uploadAvatar = asyncHandler(async (req, res) => {
    if (!req.file) throw new BadRequestError("No file provided");
    const user = await this.usersService.uploadAvatar(
      req.user!.id,
      {
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
      },
      req.user!.businessId,
    );
    sendSuccess(res, user, "Avatar uploaded");
  });

  removeAvatar = asyncHandler(async (req, res) => {
    const user = await this.usersService.removeAvatar(req.user!.id, req.user!.businessId);
    sendSuccess(res, user, "Avatar removed");
  });
}
