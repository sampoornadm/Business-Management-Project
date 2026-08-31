import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ContactsRepository } from "../contacts.repository.js";

describe("ContactsRepository (integration)", () => {
  let repository: ContactsRepository;
  let businessId: string;
  const entityId = randomUUID();

  beforeAll(async () => {
    repository = new ContactsRepository(prisma);
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: `Contacts Repo Test ${randomUUID()}`, code: `CRT${randomUUID().slice(0, 6)}` },
    });
    businessId = business.id;
  });

  afterAll(async () => {
    await prisma.contact.deleteMany({ where: { entityId } });
    await prisma.contactLookupOption.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
  });

  it("creates a contact with phones and emails, and unsets a prior primary contact for the same entity", async () => {
    const first = await repository.create({
      entityType: "ORGANIZATION",
      entityId,
      name: "Alice",
      isPrimary: true,
      phones: [{ phone: "1111111111", isPrimary: true }],
      emails: [{ email: "alice@example.com", isPrimary: true }],
    });
    expect(first.isPrimary).toBe(true);
    expect(first.phones).toHaveLength(1);
    expect(first.emails).toHaveLength(1);

    const second = await repository.create({
      entityType: "ORGANIZATION",
      entityId,
      name: "Bob",
      isPrimary: true,
    });
    expect(second.isPrimary).toBe(true);

    const refreshedFirst = await repository.findByEntity("ORGANIZATION", entityId);
    const alice = refreshedFirst.find((c) => c.name === "Alice")!;
    expect(alice.isPrimary).toBe(false);
  });

  it("fully replaces phones and emails on update", async () => {
    const contact = await repository.create({
      entityType: "VENDOR",
      entityId,
      name: "Carol",
      phones: [{ phone: "2222222222", isPrimary: true }],
    });

    const updated = await repository.update(contact.id, {
      phones: [
        { phone: "3333333333", isPrimary: true },
        { phone: "4444444444", isPrimary: false },
      ],
    });

    expect(updated.phones).toHaveLength(2);
    expect(updated.phones.map((p) => p.phone).sort()).toEqual(["3333333333", "4444444444"]);
  });

  it("upserts a lookup option only once for the same business/kind/value", async () => {
    await repository.upsertLookupOptionIfMissing(businessId, "DEPARTMENT", "Engineering");
    await repository.upsertLookupOptionIfMissing(businessId, "DEPARTMENT", "Engineering");
    const values = await repository.listLookupOptions(businessId, "DEPARTMENT");
    expect(values).toEqual(["Engineering"]);
  });

  it("confirms whether a contact belongs to the given entity", async () => {
    const contact = await repository.create({ entityType: "ORGANIZATION", entityId, name: "Dana" });
    expect(await repository.belongsToEntity(contact.id, "ORGANIZATION", entityId)).toBe(true);
    expect(await repository.belongsToEntity(contact.id, "VENDOR", entityId)).toBe(false);
    expect(await repository.belongsToEntity(randomUUID(), "ORGANIZATION", entityId)).toBe(false);
  });
});
