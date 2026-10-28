import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ItemsRepository } from "../items.repository.js";

describe("Item code assignment (integration)", () => {
  const repository = new ItemsRepository(prisma);
  let businessId: string;
  const itemIds: string[] = [];

  async function create(name: string): Promise<string> {
    const { id } = await repository.findOrCreateItem(businessId, name, "m");
    itemIds.push(id);
    return id;
  }

  const code = async (id: string) => (await prisma.item.findUniqueOrThrow({ where: { id } })).itemCode;

  beforeAll(async () => {
    const business = await prisma.business.create({
      data: { id: randomUUID(), name: "Item Code Test Business", code: `ICODE${randomUUID().slice(0, 8)}` },
    });
    businessId = business.id;
  });

  afterAll(async () => {
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
    await prisma.business.deleteMany({ where: { id: businessId } });
  });

  it("puts sizes of one item in a shared family and gives other items a new one", async () => {
    const a = await create("XLPE Cable 4C x16");
    const b = await create("XLPE Cable 4C x25");
    const c = await create("Portland Cement");

    expect(await code(a)).toBe("00000001001");
    expect(await code(b)).toBe("00000001002");
    expect(await code(c)).toBe("00000002001");
  });

  it("keeps the code stable on repeat calls and swaps only the heading prefix once HSN is confirmed", async () => {
    const id = await create("Mild Steel Washer M12");
    const before = await code(id);
    expect(await repository.ensureItemCode(id)).toBe(before);

    await repository.confirmItemHsn(businessId, "Mild Steel Washer M12", "nos", "7318", 18);

    const after = await code(id);
    expect(after?.slice(0, 4)).toBe("7318");
    expect(after?.slice(4)).toBe(before?.slice(4));
  });

  it("suggests nothing for an item with no confirmed neighbours and finds a confirmed same-family one", async () => {
    const id = await create("Mild Steel Washer M16");
    await prisma.item.update({ where: { id }, data: { familyKey: "mild steel washer m" } });
    const family = await repository.findConfirmedHsnByFamily(businessId, "mild steel washer m");
    expect(family.map((f) => f.canonicalName)).toContain("Mild Steel Washer M12");
    expect(await repository.findConfirmedHsnByFamily(businessId, "")).toEqual([]);
  });
});
