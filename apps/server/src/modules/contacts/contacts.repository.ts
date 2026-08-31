import { randomUUID } from "node:crypto";

import type { ContactEntityType, ContactLookupKind, Prisma, PrismaClient } from "@bmp/database";

export type { ContactEntityType, ContactLookupKind };

const contactWithChildren = {
  include: {
    phones: { orderBy: { isPrimary: "desc" } },
    emails: { orderBy: { isPrimary: "desc" } },
  },
} satisfies Prisma.ContactDefaultArgs;

export type ContactWithChildren = Prisma.ContactGetPayload<typeof contactWithChildren>;

export interface ContactPhoneInput {
  phone: string;
  isPrimary: boolean;
}

export interface ContactEmailInput {
  email: string;
  isPrimary: boolean;
}

export interface CreateContactData {
  entityType: ContactEntityType;
  entityId: string;
  name: string;
  department?: string | null;
  designation?: string | null;
  notes?: string | null;
  isPrimary?: boolean;
  phones?: ContactPhoneInput[];
  emails?: ContactEmailInput[];
}

export type UpdateContactData = Partial<Omit<CreateContactData, "entityType" | "entityId">>;

export interface IContactsRepository {
  findByEntity(entityType: ContactEntityType, entityId: string): Promise<ContactWithChildren[]>;
  create(data: CreateContactData): Promise<ContactWithChildren>;
  update(id: string, data: UpdateContactData): Promise<ContactWithChildren>;
  delete(id: string): Promise<void>;
  belongsToEntity(contactId: string, entityType: ContactEntityType, entityId: string): Promise<boolean>;
  listLookupOptions(businessId: string, kind: ContactLookupKind): Promise<string[]>;
  upsertLookupOptionIfMissing(businessId: string, kind: ContactLookupKind, value: string): Promise<void>;
}

export class ContactsRepository implements IContactsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByEntity(entityType: ContactEntityType, entityId: string): Promise<ContactWithChildren[]> {
    return this.prisma.contact.findMany({
      where: { entityType, entityId },
      orderBy: { isPrimary: "desc" },
      ...contactWithChildren,
    });
  }

  async create(data: CreateContactData): Promise<ContactWithChildren> {
    const { phones, emails, ...rest } = data;
    return this.prisma.$transaction(async (tx) => {
      if (rest.isPrimary) {
        await tx.contact.updateMany({
          where: { entityType: rest.entityType, entityId: rest.entityId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.contact.create({
        data: {
          id: randomUUID(),
          ...rest,
          phones: { create: (phones ?? []).map((p) => ({ id: randomUUID(), ...p })) },
          emails: { create: (emails ?? []).map((e) => ({ id: randomUUID(), ...e })) },
        },
        ...contactWithChildren,
      });
    });
  }

  async update(id: string, data: UpdateContactData): Promise<ContactWithChildren> {
    const { phones, emails, ...rest } = data;
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.contact.findUniqueOrThrow({ where: { id } });
      if (rest.isPrimary) {
        await tx.contact.updateMany({
          where: {
            entityType: existing.entityType,
            entityId: existing.entityId,
            isPrimary: true,
            id: { not: id },
          },
          data: { isPrimary: false },
        });
      }
      if (phones !== undefined) {
        await tx.contactPhone.deleteMany({ where: { contactId: id } });
      }
      if (emails !== undefined) {
        await tx.contactEmail.deleteMany({ where: { contactId: id } });
      }
      return tx.contact.update({
        where: { id },
        data: {
          ...rest,
          ...(phones !== undefined
            ? { phones: { create: phones.map((p) => ({ id: randomUUID(), ...p })) } }
            : {}),
          ...(emails !== undefined
            ? { emails: { create: emails.map((e) => ({ id: randomUUID(), ...e })) } }
            : {}),
        },
        ...contactWithChildren,
      });
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.contact.delete({ where: { id } });
  }

  async belongsToEntity(contactId: string, entityType: ContactEntityType, entityId: string): Promise<boolean> {
    const count = await this.prisma.contact.count({ where: { id: contactId, entityType, entityId } });
    return count > 0;
  }

  async listLookupOptions(businessId: string, kind: ContactLookupKind): Promise<string[]> {
    const rows = await this.prisma.contactLookupOption.findMany({
      where: { businessId, kind },
      orderBy: { value: "asc" },
      select: { value: true },
    });
    return rows.map((row) => row.value);
  }

  async upsertLookupOptionIfMissing(businessId: string, kind: ContactLookupKind, value: string): Promise<void> {
    await this.prisma.contactLookupOption.upsert({
      where: { businessId_kind_value: { businessId, kind, value } },
      create: { id: randomUUID(), businessId, kind, value },
      update: {},
    });
  }
}
