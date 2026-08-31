import { sendSuccess } from "../../core/response/ApiResponse.js";
import { asyncHandler } from "../../shared/middleware/asyncHandler.js";

import type { ContactsService } from "./contacts.service.js";
import type { ListLookupOptionsQuery } from "./contacts.validation.js";

export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  listLookupOptions = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListLookupOptionsQuery;
    const values = await this.contactsService.listLookupOptions(req.user!.businessId, query.kind);
    sendSuccess(res, { kind: query.kind, values });
  });
}
