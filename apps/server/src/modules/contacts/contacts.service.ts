import type { ContactDto } from "@bmp/types";

import type {
  ContactEntityType,
  ContactLookupKind,
  CreateContactData,
  IContactsRepository,
  UpdateContactData,
} from "./contacts.repository.js";
import { toContactDto } from "./contacts.mapper.js";

export class ContactsService {
  constructor(private readonly contactsRepository: IContactsRepository) {}

  async listContacts(entityType: ContactEntityType, entityId: string): Promise<ContactDto[]> {
    const contacts = await this.contactsRepository.findByEntity(entityType, entityId);
    return contacts.map(toContactDto);
  }

  async createContact(
    entityType: ContactEntityType,
    entityId: string,
    data: Omit<CreateContactData, "entityType" | "entityId">,
    businessId: string,
  ): Promise<void> {
    await this.registerLookupOptions(businessId, data.department, data.designation);
    await this.contactsRepository.create({ entityType, entityId, ...data });
  }

  async updateContact(contactId: string, data: UpdateContactData, businessId: string): Promise<void> {
    await this.registerLookupOptions(businessId, data.department, data.designation);
    await this.contactsRepository.update(contactId, data);
  }

  async deleteContact(contactId: string): Promise<void> {
    await this.contactsRepository.delete(contactId);
  }

  async belongsToEntity(contactId: string, entityType: ContactEntityType, entityId: string): Promise<boolean> {
    return this.contactsRepository.belongsToEntity(contactId, entityType, entityId);
  }

  async listLookupOptions(businessId: string, kind: ContactLookupKind): Promise<string[]> {
    return this.contactsRepository.listLookupOptions(businessId, kind);
  }

  private async registerLookupOptions(
    businessId: string,
    department: string | null | undefined,
    designation: string | null | undefined,
  ): Promise<void> {
    if (department) {
      await this.contactsRepository.upsertLookupOptionIfMissing(businessId, "DEPARTMENT", department);
    }
    if (designation) {
      await this.contactsRepository.upsertLookupOptionIfMissing(businessId, "DESIGNATION", designation);
    }
  }
}