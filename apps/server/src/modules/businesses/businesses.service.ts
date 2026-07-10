import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";
import type { RequestContext } from "../../core/interfaces/request-context.js";
import type { AuditService } from "../audit/audit.service.js";

import type { BusinessDto } from "./businesses.mapper.js";
import { toBusinessDto } from "./businesses.mapper.js";
import type {
  BusinessFilters,
  CreateBusinessData,
  CreateContactData,
  IBusinessesRepository,
  MemberWithRole,
  UpdateBusinessData,
  UpdateContactData,
} from "./businesses.repository.js";

export class BusinessesService {
  constructor(
    private readonly businessesRepository: IBusinessesRepository,
    private readonly auditService: AuditService,
  ) {}

  async listBusinesses(
    pagination: PaginationParams,
    filters: BusinessFilters,
  ): Promise<PaginatedResult<BusinessDto>> {
    const { items, totalItems } = await this.businessesRepository.findMany(pagination, filters);
    return buildPaginatedResult(items.map(toBusinessDto), totalItems, pagination);
  }

  async getById(id: string): Promise<BusinessDto> {
    const business = await this.businessesRepository.findById(id);
    if (!business) throw new NotFoundError("Business not found");
    return toBusinessDto(business);
  }

  async create(
    data: CreateBusinessData,
    actorId: string,
    context: RequestContext = {},
  ): Promise<BusinessDto> {
    const business = await this.businessesRepository.create(data);
    await this.auditService.log({
      actorId,
      action: "BUSINESS_CREATED",
      entityType: "Business",
      entityId: business.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return toBusinessDto(business);
  }

  async update(
    id: string,
    data: UpdateBusinessData,
    actorId: string,
    context: RequestContext = {},
  ): Promise<BusinessDto> {
    await this.getById(id);
    const business = await this.businessesRepository.update(id, data);
    await this.auditService.log({
      actorId,
      action: "BUSINESS_UPDATED",
      entityType: "Business",
      entityId: id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return toBusinessDto(business);
  }

  async delete(id: string, actorId: string, context: RequestContext = {}): Promise<void> {
    await this.getById(id);
    const tenderCount = await this.businessesRepository.countTenders(id);
    if (tenderCount > 0) {
      throw new ConflictError("Cannot delete a business that still has tenders");
    }
    await this.businessesRepository.delete(id);
    await this.auditService.log({
      actorId,
      action: "BUSINESS_DELETED",
      entityType: "Business",
      entityId: id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  private async assertContactBelongsToBusiness(businessId: string, contactId: string): Promise<void> {
    const contact = await this.businessesRepository.findContactById(contactId);
    if (!contact || contact.businessId !== businessId) {
      throw new NotFoundError("Business contact not found");
    }
  }

  async addContact(businessId: string, data: Omit<CreateContactData, "businessId">): Promise<BusinessDto> {
    await this.getById(businessId);
    await this.businessesRepository.createContact({ ...data, businessId });
    return this.getById(businessId);
  }

  async updateContact(businessId: string, contactId: string, data: UpdateContactData): Promise<BusinessDto> {
    await this.assertContactBelongsToBusiness(businessId, contactId);
    await this.businessesRepository.updateContact(contactId, data);
    return this.getById(businessId);
  }

  async deleteContact(businessId: string, contactId: string): Promise<BusinessDto> {
    await this.assertContactBelongsToBusiness(businessId, contactId);
    await this.businessesRepository.deleteContact(contactId);
    return this.getById(businessId);
  }

  async listMembers(businessId: string): Promise<MemberWithRole[]> {
    await this.getById(businessId);
    return this.businessesRepository.listMembers(businessId);
  }

  async addMember(businessId: string, userId: string, roleId: string, actorId: string): Promise<void> {
    await this.getById(businessId);
    const existing = await this.businessesRepository.findMembership(userId, businessId);
    if (existing) throw new ConflictError("User is already a member of this business");
    await this.businessesRepository.addMember(businessId, userId, roleId);
    await this.auditService.log({
      actorId,
      action: "BUSINESS_MEMBER_ADDED",
      entityType: "Business",
      entityId: businessId,
      metadata: { userId, roleId },
    });
  }

  async updateMemberRole(businessId: string, userId: string, roleId: string, actorId: string): Promise<void> {
    const existing = await this.businessesRepository.findMembership(userId, businessId);
    if (!existing) throw new NotFoundError("Membership not found");
    await this.businessesRepository.updateMemberRole(businessId, userId, roleId);
    await this.auditService.log({
      actorId,
      action: "BUSINESS_MEMBER_ROLE_UPDATED",
      entityType: "Business",
      entityId: businessId,
      metadata: { userId, roleId },
    });
  }

  async removeMember(businessId: string, userId: string, actorId: string): Promise<void> {
    const existing = await this.businessesRepository.findMembership(userId, businessId);
    if (!existing) throw new NotFoundError("Membership not found");
    const members = await this.businessesRepository.listMembers(businessId);
    if (members.length === 1) {
      throw new BadRequestError("Cannot remove the last member of a business");
    }
    await this.businessesRepository.removeMember(businessId, userId);
    await this.auditService.log({
      actorId,
      action: "BUSINESS_MEMBER_REMOVED",
      entityType: "Business",
      entityId: businessId,
      metadata: { userId },
    });
  }
}
