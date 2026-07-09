import type {
  ImportVendorItemTagsResult,
  PaginatedResult,
  VendorDto,
  VendorListItemDto,
  VendorPerformanceDto,
} from "@bmp/types";

import { ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";
import type { AuditService } from "../audit/audit.service.js";

import { parseVendorItemTagsFile } from "./vendor-item-tags.parser.js";
import { toVendorDto, toVendorListItemDto, toVendorPerformanceDto } from "./vendors.mapper.js";
import type {
  CreateContactData,
  CreateVendorData,
  IVendorsRepository,
  UpdateContactData,
  UpdateVendorData,
  VendorFilters,
} from "./vendors.repository.js";

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export class VendorsService {
  constructor(
    private readonly vendorsRepository: IVendorsRepository,
    private readonly auditService: AuditService,
  ) {}

  async listVendors(
    pagination: PaginationParams,
    filters: VendorFilters,
  ): Promise<PaginatedResult<VendorListItemDto>> {
    const { items, totalItems } = await this.vendorsRepository.findMany(pagination, filters);
    return buildPaginatedResult(items.map(toVendorListItemDto), totalItems, pagination);
  }

  async getById(id: string): Promise<VendorDto> {
    const vendor = await this.vendorsRepository.findById(id);
    if (!vendor) throw new NotFoundError("Vendor not found");
    return toVendorDto(vendor);
  }

  async create(data: CreateVendorData, context: RequestContext = {}): Promise<VendorDto> {
    const vendor = await this.vendorsRepository.create(data);
    await this.auditService.log({
      actorId: data.createdById,
      action: "VENDOR_CREATED",
      entityType: "Vendor",
      entityId: vendor.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return toVendorDto(vendor);
  }

  async update(
    id: string,
    data: UpdateVendorData,
    actorId: string,
    context: RequestContext = {},
  ): Promise<VendorDto> {
    const existing = await this.vendorsRepository.findById(id);
    if (!existing) throw new NotFoundError("Vendor not found");

    const vendor = await this.vendorsRepository.update(id, data);
    await this.auditService.log({
      actorId,
      action: "VENDOR_UPDATED",
      entityType: "Vendor",
      entityId: id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return toVendorDto(vendor);
  }

  async delete(id: string, actorId: string, context: RequestContext = {}): Promise<void> {
    const existing = await this.vendorsRepository.findById(id);
    if (!existing) throw new NotFoundError("Vendor not found");

    const poCount = await this.vendorsRepository.countPurchaseOrders(id);
    if (poCount > 0) {
      throw new ConflictError(`Cannot delete this vendor: it is referenced by ${poCount} purchase order(s)`);
    }

    await this.vendorsRepository.delete(id);
    await this.auditService.log({
      actorId,
      action: "VENDOR_DELETED",
      entityType: "Vendor",
      entityId: id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  private async assertContactBelongsToVendor(vendorId: string, contactId: string): Promise<void> {
    const vendor = await this.vendorsRepository.findById(vendorId);
    if (!vendor) throw new NotFoundError("Vendor not found");
    if (!vendor.contacts.some((c) => c.id === contactId)) {
      throw new NotFoundError("Contact not found for this vendor");
    }
  }

  async addContact(
    vendorId: string,
    data: Omit<CreateContactData, "vendorId">,
    actorId: string,
  ): Promise<VendorDto> {
    const vendor = await this.vendorsRepository.findById(vendorId);
    if (!vendor) throw new NotFoundError("Vendor not found");

    await this.vendorsRepository.createContact({ vendorId, ...data });
    await this.auditService.log({
      actorId,
      action: "VENDOR_CONTACT_ADDED",
      entityType: "Vendor",
      entityId: vendorId,
    });
    return this.getById(vendorId);
  }

  async updateContact(
    vendorId: string,
    contactId: string,
    data: UpdateContactData,
    actorId: string,
  ): Promise<VendorDto> {
    await this.assertContactBelongsToVendor(vendorId, contactId);
    await this.vendorsRepository.updateContact(contactId, data);
    await this.auditService.log({
      actorId,
      action: "VENDOR_CONTACT_UPDATED",
      entityType: "Vendor",
      entityId: vendorId,
    });
    return this.getById(vendorId);
  }

  async deleteContact(vendorId: string, contactId: string, actorId: string): Promise<VendorDto> {
    await this.assertContactBelongsToVendor(vendorId, contactId);
    await this.vendorsRepository.deleteContact(contactId);
    await this.auditService.log({
      actorId,
      action: "VENDOR_CONTACT_DELETED",
      entityType: "Vendor",
      entityId: vendorId,
    });
    return this.getById(vendorId);
  }

  async getPerformance(vendorId: string): Promise<VendorPerformanceDto> {
    const vendor = await this.vendorsRepository.findById(vendorId);
    if (!vendor) throw new NotFoundError("Vendor not found");
    const ratings = await this.vendorsRepository.findRatings(vendorId);
    return toVendorPerformanceDto(vendorId, ratings);
  }

  private async assertItemTagBelongsToVendor(vendorId: string, tagId: string): Promise<void> {
    const vendor = await this.vendorsRepository.findById(vendorId);
    if (!vendor) throw new NotFoundError("Vendor not found");
    if (!vendor.itemTags.some((tag) => tag.id === tagId)) {
      throw new NotFoundError("Item tag not found for this vendor");
    }
  }

  async addItemTag(
    vendorId: string,
    data: { itemType: string; make?: string },
    actorId: string,
  ): Promise<VendorDto> {
    const vendor = await this.vendorsRepository.findById(vendorId);
    if (!vendor) throw new NotFoundError("Vendor not found");

    await this.vendorsRepository.createItemTag({ vendorId, ...data });
    await this.auditService.log({
      actorId,
      action: "VENDOR_ITEM_TAG_ADDED",
      entityType: "Vendor",
      entityId: vendorId,
      metadata: { itemType: data.itemType, make: data.make ?? null },
    });
    return this.getById(vendorId);
  }

  async removeItemTag(vendorId: string, tagId: string, actorId: string): Promise<VendorDto> {
    await this.assertItemTagBelongsToVendor(vendorId, tagId);
    await this.vendorsRepository.deleteItemTag(tagId);
    await this.auditService.log({
      actorId,
      action: "VENDOR_ITEM_TAG_REMOVED",
      entityType: "Vendor",
      entityId: vendorId,
    });
    return this.getById(vendorId);
  }

  // Vendor is resolved by exact (case-insensitive) name match against
  // existing vendors — a row whose name doesn't match anything is reported
  // back as skipped rather than silently creating a new vendor from what
  // could just be a typo.
  async importItemTags(buffer: Buffer, actorId: string): Promise<ImportVendorItemTagsResult> {
    const parsed = await parseVendorItemTagsFile(buffer);
    const skipped = [...parsed.skipped];
    let imported = 0;

    for (const row of parsed.rows) {
      const vendor = await this.vendorsRepository.findByNameExact(row.vendorName);
      if (!vendor) {
        skipped.push({ row: row.row, vendorName: row.vendorName, reason: "No vendor with this name exists" });
        continue;
      }
      await this.vendorsRepository.createItemTag({
        vendorId: vendor.id,
        itemType: row.itemType,
        make: row.make,
      });
      imported += 1;
    }

    await this.auditService.log({
      actorId,
      action: "VENDOR_ITEM_TAGS_IMPORTED",
      entityType: "Vendor",
      entityId: "bulk",
      metadata: { imported, skippedCount: skipped.length },
    });
    return { imported, skipped };
  }
}
