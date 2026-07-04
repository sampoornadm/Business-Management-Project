import type { OrganizationDto, OrganizationListItemDto, PaginatedResult } from "@bmp/types";

import { ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";
import type { AuditService } from "../audit/audit.service.js";

import {
  toOrganizationDto,
  toOrganizationListItemDto,
} from "./organizations.mapper.js";
import type {
  CreateContactData,
  CreateOrganizationData,
  IOrganizationsRepository,
  OrganizationFilters,
  UpdateContactData,
  UpdateOrganizationData,
} from "./organizations.repository.js";

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export class OrganizationsService {
  constructor(
    private readonly organizationsRepository: IOrganizationsRepository,
    private readonly auditService: AuditService,
  ) {}

  async listOrganizations(
    pagination: PaginationParams,
    filters: OrganizationFilters,
  ): Promise<PaginatedResult<OrganizationListItemDto>> {
    const { items, totalItems } = await this.organizationsRepository.findMany(pagination, filters);
    return buildPaginatedResult(items.map(toOrganizationListItemDto), totalItems, pagination);
  }

  async getById(id: string): Promise<OrganizationDto> {
    const organization = await this.organizationsRepository.findById(id);
    if (!organization) throw new NotFoundError("Organization not found");
    return toOrganizationDto(organization);
  }

  async create(
    data: CreateOrganizationData,
    context: RequestContext = {},
  ): Promise<OrganizationDto> {
    const organization = await this.organizationsRepository.create(data);
    await this.auditService.log({
      actorId: data.createdById,
      action: "ORGANIZATION_CREATED",
      entityType: "Organization",
      entityId: organization.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return toOrganizationDto(organization);
  }

  async update(
    id: string,
    data: UpdateOrganizationData,
    actorId: string,
    context: RequestContext = {},
  ): Promise<OrganizationDto> {
    const existing = await this.organizationsRepository.findById(id);
    if (!existing) throw new NotFoundError("Organization not found");

    const organization = await this.organizationsRepository.update(id, data);
    await this.auditService.log({
      actorId,
      action: "ORGANIZATION_UPDATED",
      entityType: "Organization",
      entityId: id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return toOrganizationDto(organization);
  }

  async delete(id: string, actorId: string, context: RequestContext = {}): Promise<void> {
    const existing = await this.organizationsRepository.findById(id);
    if (!existing) throw new NotFoundError("Organization not found");

    const tenderCount = await this.organizationsRepository.countTenders(id);
    if (tenderCount > 0) {
      throw new ConflictError(
        `Cannot delete this organization: it is referenced by ${tenderCount} tender(s)`,
      );
    }

    await this.organizationsRepository.delete(id);
    await this.auditService.log({
      actorId,
      action: "ORGANIZATION_DELETED",
      entityType: "Organization",
      entityId: id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  private async assertContactBelongsToOrg(organizationId: string, contactId: string): Promise<void> {
    const organization = await this.organizationsRepository.findById(organizationId);
    if (!organization) throw new NotFoundError("Organization not found");
    if (!organization.contacts.some((c) => c.id === contactId)) {
      throw new NotFoundError("Contact not found for this organization");
    }
  }

  async addContact(
    organizationId: string,
    data: Omit<CreateContactData, "organizationId">,
    actorId: string,
  ): Promise<OrganizationDto> {
    const organization = await this.organizationsRepository.findById(organizationId);
    if (!organization) throw new NotFoundError("Organization not found");

    await this.organizationsRepository.createContact({ organizationId, ...data });
    await this.auditService.log({
      actorId,
      action: "ORGANIZATION_CONTACT_ADDED",
      entityType: "Organization",
      entityId: organizationId,
    });
    return this.getById(organizationId);
  }

  async updateContact(
    organizationId: string,
    contactId: string,
    data: UpdateContactData,
    actorId: string,
  ): Promise<OrganizationDto> {
    await this.assertContactBelongsToOrg(organizationId, contactId);
    await this.organizationsRepository.updateContact(contactId, data);
    await this.auditService.log({
      actorId,
      action: "ORGANIZATION_CONTACT_UPDATED",
      entityType: "Organization",
      entityId: organizationId,
    });
    return this.getById(organizationId);
  }

  async deleteContact(organizationId: string, contactId: string, actorId: string): Promise<OrganizationDto> {
    await this.assertContactBelongsToOrg(organizationId, contactId);
    await this.organizationsRepository.deleteContact(contactId);
    await this.auditService.log({
      actorId,
      action: "ORGANIZATION_CONTACT_DELETED",
      entityType: "Organization",
      entityId: organizationId,
    });
    return this.getById(organizationId);
  }
}
