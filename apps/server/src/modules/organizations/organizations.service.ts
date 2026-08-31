import type { CreateContactInput, OrganizationDto, OrganizationListItemDto, PaginatedResult, UpdateContactInput } from "@bmp/types";

import { ConflictError, NotFoundError } from "../../core/errors/HttpErrors.js";
import { buildPaginatedResult, type PaginationParams } from "../../core/interfaces/pagination.js";
import type { RequestContext } from "../../core/interfaces/request-context.js";
import type { AuditService } from "../audit/audit.service.js";
import type { ContactsService } from "../contacts/contacts.service.js";

import {
  toOrganizationDto,
  toOrganizationListItemDto,
} from "./organizations.mapper.js";
import type {
  CreateOrganizationData,
  IOrganizationsRepository,
  OrganizationFilters,
  UpdateOrganizationData,
} from "./organizations.repository.js";

export class OrganizationsService {
  constructor(
    private readonly organizationsRepository: IOrganizationsRepository,
    private readonly auditService: AuditService,
    private readonly contactsService: ContactsService,
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
    const contacts = await this.contactsService.listContacts("ORGANIZATION", id);
    return toOrganizationDto(organization, contacts);
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
    return toOrganizationDto(organization, []);
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
    const contacts = await this.contactsService.listContacts("ORGANIZATION", id);
    return toOrganizationDto(organization, contacts);
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
    const belongs = await this.contactsService.belongsToEntity(contactId, "ORGANIZATION", organizationId);
    if (!belongs) throw new NotFoundError("Contact not found for this organization");
  }

  async addContact(
    organizationId: string,
    data: CreateContactInput,
    actorId: string,
    businessId: string,
  ): Promise<OrganizationDto> {
    const organization = await this.organizationsRepository.findById(organizationId);
    if (!organization) throw new NotFoundError("Organization not found");

    await this.contactsService.createContact("ORGANIZATION", organizationId, data, businessId);
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
    data: UpdateContactInput,
    actorId: string,
    businessId: string,
  ): Promise<OrganizationDto> {
    await this.assertContactBelongsToOrg(organizationId, contactId);
    await this.contactsService.updateContact(contactId, data, businessId);
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
    await this.contactsService.deleteContact(contactId);
    await this.auditService.log({
      actorId,
      action: "ORGANIZATION_CONTACT_DELETED",
      entityType: "Organization",
      entityId: organizationId,
    });
    return this.getById(organizationId);
  }
}
