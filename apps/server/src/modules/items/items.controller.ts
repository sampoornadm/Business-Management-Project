import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";
import { resolvePagination } from "../../shared/utils/pagination.js";
import { exportTableToCsv, exportTableToXlsx } from "../../shared/utils/table-export.js";

import { buildItemExportTable, ITEM_EXPORT_COLUMN_KEYS } from "./items.mapper.js";
import type { ItemsService } from "./items.service.js";
import type {
  ClassifyBatchQuery,
  ExportItemsQueryParsed,
  ListItemsQueryParsed,
  RenameItemBody,
  UpdateItemCategoryBody,
} from "./items.validation.js";

export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  list = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListItemsQueryParsed;
    const pagination = resolvePagination(query);
    const result = await this.itemsService.listItems(pagination, {
      businessId: req.user!.businessId,
      search: query.search,
      status: query.status,
      filters: query.filters,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
    sendSuccess(res, result, "Items retrieved");
  });

  exportItems = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ExportItemsQueryParsed;
    const pagination = resolvePagination(query);
    const items = await this.itemsService.exportItems(
      {
        businessId: req.user!.businessId,
        search: query.search,
        status: query.status,
        filters: query.filters,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      },
      query.scope,
      pagination,
    );

    const columnKeys = query.columns ?? ITEM_EXPORT_COLUMN_KEYS;
    const table = buildItemExportTable(items, columnKeys);
    const date = new Date().toISOString().slice(0, 10);

    if (query.format === "xlsx") {
      const buffer = await exportTableToXlsx(table);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="items-export-${date}.xlsx"`);
      res.send(buffer);
      return;
    }

    const buffer = exportTableToCsv(table);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="items-export-${date}.csv"`);
    res.send(buffer);
  });

  getById = asyncHandler(async (req, res) => {
    const item = await this.itemsService.getItemDetail(req.params.id!, req.user!.businessId);
    sendSuccess(res, item, "Item retrieved");
  });

  setCategory = asyncHandler(async (req, res) => {
    const body = req.body as UpdateItemCategoryBody;
    const item = await this.itemsService.setCategory(req.params.id!, req.user!.businessId, body);
    sendSuccess(res, item, "Item category updated");
  });

  rename = asyncHandler(async (req, res) => {
    const body = req.body as RenameItemBody;
    const item = await this.itemsService.renameItem(req.params.id!, req.user!.businessId, body.canonicalName);
    sendSuccess(res, item, "Item renamed");
  });

  classify = asyncHandler(async (req, res) => {
    const item = await this.itemsService.classifyItem(req.params.id!, req.user!.businessId, req.user!.id);
    sendSuccess(res, item, "Item classified");
  });

  classifyBatch = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ClassifyBatchQuery;
    const result = await this.itemsService.classifyUnclassified(
      req.user!.businessId,
      query.limit ?? 10,
      req.user!.id,
    );
    sendSuccess(res, result, `Classified ${result.classified} item(s)`);
  });
}
