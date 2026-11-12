import type { PrismaClient } from "@bmp/database";
import { formatItemCodeForDisplay } from "@bmp/types";

/** An audited entity's readable code and owning business (null business = global entity). */
export interface EntityRef {
  code: string | null;
  businessId: string | null;
}

/** Looks up an audited entity's code and business; null when the type is unknown or the row is gone. */
export type EntityCodeResolver = (entityType: string, entityId: string) => Promise<EntityRef | null>;

const ref = (code: string | null | undefined, businessId: string | null) => ({ code: code ?? null, businessId });

/**
 * Takes the UNscoped base client on purpose: the audit log spans businesses and these are by-id
 * lookups of display fields. Keep the mapping in sync with the backfills in migrations
 * 20261112000000_submission_history and 20261112010000_audit_business_scope.
 */
export function createEntityCodeResolver(prisma: PrismaClient): EntityCodeResolver {
  const lookups: Record<string, (id: string) => Promise<EntityRef | null>> = {
    Tender: async (id) => {
      const t = await prisma.tender.findUnique({ where: { id }, select: { tenderNumber: true, businessId: true } });
      return t && ref(t.tenderNumber, t.businessId);
    },
    BoqItem: async (id) => {
      const item = await prisma.boqItem.findUnique({
        where: { id },
        select: { boq: { select: { businessId: true, tender: { select: { tenderNumber: true } } } } },
      });
      return item && ref(item.boq.tender.tenderNumber, item.boq.businessId);
    },
    Item: async (id) => {
      const item = await prisma.item.findUnique({
        where: { id },
        select: { itemCode: true, canonicalName: true, businessId: true },
      });
      return item && ref(item.itemCode ? formatItemCodeForDisplay(item.itemCode) : item.canonicalName, item.businessId);
    },
    Rfq: async (id) => {
      const r = await prisma.rfq.findUnique({ where: { id }, select: { title: true, businessId: true } });
      return r && ref(r.title, r.businessId);
    },
    PurchaseOrder: async (id) => {
      const p = await prisma.purchaseOrder.findUnique({ where: { id }, select: { poNumber: true, businessId: true } });
      return p && ref(p.poNumber, p.businessId);
    },
    Bill: async (id) => {
      const b = await prisma.bill.findUnique({ where: { id }, select: { billNumber: true, businessId: true } });
      return b && ref(b.billNumber, b.businessId);
    },
    Project: async (id) => {
      const p = await prisma.project.findUnique({ where: { id }, select: { name: true, businessId: true } });
      return p && ref(p.name, p.businessId);
    },
    Invoice: async (id) => {
      const i = await prisma.invoice.findUnique({ where: { id }, select: { invoiceNumber: true, businessId: true } });
      return i && ref(i.invoiceNumber, i.businessId);
    },
    Expense: async (id) => {
      const e = await prisma.expense.findUnique({ where: { id }, select: { description: true, businessId: true } });
      return e && ref(e.description, e.businessId);
    },
    BankAccount: async (id) => {
      const b = await prisma.bankAccount.findUnique({ where: { id }, select: { name: true, businessId: true } });
      return b && ref(b.name, b.businessId);
    },
    Business: async (id) => {
      const b = await prisma.business.findUnique({ where: { id }, select: { code: true } });
      return b && ref(b.code, id);
    },
    // Global entities: shared across businesses, so their rows stay visible to every admin.
    Vendor: async (id) => ref((await prisma.vendor.findUnique({ where: { id }, select: { name: true } }))?.name, null),
    Organization: async (id) =>
      ref((await prisma.organization.findUnique({ where: { id }, select: { name: true } }))?.name, null),
    User: async (id) => ref((await prisma.user.findUnique({ where: { id }, select: { email: true } }))?.email, null),
  };

  return async (entityType, entityId) => {
    const found = await lookups[entityType]?.(entityId);
    return found && found.code !== null ? found : null;
  };
}
