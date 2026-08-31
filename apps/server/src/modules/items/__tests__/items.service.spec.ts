import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "../../../core/errors/HttpErrors.js";
import type { CategoriesService } from "../../categories/categories.service.js";
import type { RfqService } from "../../rfq/rfq.service.js";
import type {
  BoqNameRow,
  ConfirmedMatchRow,
  IItemsRepository,
  ItemForClassify,
  ItemQuoteRow,
  ItemRow,
  NearestConfirmedMatch,
  UnlinkedRfqItem,
} from "../items.repository.js";
import { ItemsService } from "../items.service.js";

const BUSINESS_ID = "business-1";

type StoredItem = ItemRow & { businessId: string };

class FakeItemsRepository implements IItemsRepository {
  items = new Map<string, StoredItem>();

  findUnlinkedRfqItems(): Promise<UnlinkedRfqItem[]> {
    return Promise.resolve([]);
  }

  findBoqNames(): Promise<BoqNameRow[]> {
    return Promise.resolve([]);
  }

  findOrCreateItem(): Promise<{ id: string }> {
    throw new Error("not used in this test");
  }

  linkRfqItems(): Promise<void> {
    return Promise.resolve();
  }

  findItems(): Promise<ItemRow[]> {
    return Promise.resolve([...this.items.values()]);
  }

  findQuoteRowsForItems(): Promise<ItemQuoteRow[]> {
    return Promise.resolve([]);
  }

  findById(id: string, businessId: string): Promise<ItemRow | null> {
    const item = this.items.get(id);
    return Promise.resolve(item && item.businessId === businessId ? item : null);
  }

  findByCanonicalName(businessId: string, canonicalName: string): Promise<{ id: string } | null> {
    const match = [...this.items.values()].find(
      (i) => i.businessId === businessId && i.canonicalName === canonicalName,
    );
    return Promise.resolve(match ? { id: match.id } : null);
  }

  renameItem(id: string, canonicalName: string): Promise<void> {
    const item = this.items.get(id);
    if (item) item.canonicalName = canonicalName;
    return Promise.resolve();
  }

  updateCategory(): Promise<void> {
    return Promise.resolve();
  }

  findUnclassified(): Promise<ItemForClassify[]> {
    return Promise.resolve([]);
  }

  countUnclassified(): Promise<number> {
    return Promise.resolve(0);
  }

  getForClassify(): Promise<ItemForClassify | null> {
    return Promise.resolve(null);
  }

  setEmbedding(): Promise<void> {
    return Promise.resolve();
  }

  findConfirmedForMatch(): Promise<ConfirmedMatchRow[]> {
    return Promise.resolve([]);
  }

  findNearestConfirmedMatch(): Promise<NearestConfirmedMatch[]> {
    return Promise.resolve([]);
  }
}

function makeItem(overrides: {
  id: string;
  canonicalName: string;
  businessId?: string;
}): StoredItem {
  return {
    businessId: BUSINESS_ID,
    unit: null,
    categoryId: null,
    categoryConfirmed: false,
    aiConfidence: null,
    ...overrides,
  };
}

describe("ItemsService.renameItem", () => {
  let repository: FakeItemsRepository;
  let service: ItemsService;

  beforeEach(() => {
    repository = new FakeItemsRepository();
    const rfqService = {
      listItemPrices: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    } as unknown as RfqService;
    const categoriesService = {
      getPathMap: vi.fn().mockResolvedValue(new Map<string, string>()),
    } as unknown as CategoriesService;
    service = new ItemsService(repository, rfqService, categoriesService);
  });

  it("renames the item when the new name is free", async () => {
    const item = makeItem({ id: "item-1", canonicalName: "FKM O-Ring 42x58x8" });
    repository.items.set(item.id, item);

    const result = await service.renameItem("item-1", BUSINESS_ID, "FKM O-Ring 42x58x8mm 80SH");

    expect(result.canonicalName).toBe("FKM O-Ring 42x58x8mm 80SH");
    expect(repository.items.get("item-1")!.canonicalName).toBe("FKM O-Ring 42x58x8mm 80SH");
  });

  it("collapses whitespace like deriveCanonicalName does", async () => {
    const item = makeItem({ id: "item-1", canonicalName: "Old Name" });
    repository.items.set(item.id, item);

    const result = await service.renameItem("item-1", BUSINESS_ID, "  New   Name  ");

    expect(result.canonicalName).toBe("New Name");
  });

  it("rejects a rename that collides with a different item's name", async () => {
    const a = makeItem({ id: "item-a", canonicalName: "O-Ring A" });
    const b = makeItem({ id: "item-b", canonicalName: "O-Ring B" });
    repository.items.set(a.id, a);
    repository.items.set(b.id, b);

    await expect(service.renameItem("item-a", BUSINESS_ID, "O-Ring B")).rejects.toThrow(ConflictError);
    // Unchanged — the rejected rename must not have gone through.
    expect(repository.items.get("item-a")!.canonicalName).toBe("O-Ring A");
  });

  it("allows renaming to the item's own current name (not a false collision)", async () => {
    const item = makeItem({ id: "item-1", canonicalName: "Same Name" });
    repository.items.set(item.id, item);

    const result = await service.renameItem("item-1", BUSINESS_ID, "Same Name");

    expect(result.canonicalName).toBe("Same Name");
  });

  it("throws NotFoundError for an item outside the caller's business", async () => {
    const item = makeItem({ id: "item-1", canonicalName: "Name", businessId: "other-business" });
    repository.items.set(item.id, item);

    await expect(service.renameItem("item-1", BUSINESS_ID, "New Name")).rejects.toThrow(NotFoundError);
  });
});
