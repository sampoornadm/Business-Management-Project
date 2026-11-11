import type { PrismaClient } from "@bmp/database";
import { formatItemCodeForDisplay } from "@bmp/types";

/** Readable code for an audited entity (tender number, PO number, item code, …), or null. */
export type EntityCodeResolver = (entityType: string, entityId: string) => Promise<string | null>;

/**
 * Takes the UNscoped base client on purpose: the audit log is global (AuditLog has no businessId)
 * and these are by-id lookups of a single display field. Keep the mapping in sync with the backfill
 * in migration 20261112000000_submission_history.
 */
export function createEntityCodeResolver(prisma: PrismaClient): EntityCodeResolver {
  const lookups: Record<string, (id: string) => Promise<string | null | undefined>> = {
    Tender: async (id) => (await prisma.tender.findUnique({ where: { id }, select: { tenderNumber: true } }))?.tenderNumber,
    BoqItem: async (id) =>
      (
        await prisma.boqItem.findUnique({
          where: { id },
          select: { boq: { select: { tender: { select: { tenderNumber: true } } } } },
        })
      )?.boq.tender.tenderNumber,
    Item: async (id) => {
      const item = await prisma.item.findUnique({ where: { id }, select: { itemCode: true, canonicalName: true } });
      return item ? (item.itemCode ? formatItemCodeForDisplay(item.itemCode) : item.canonicalName) : null;
    },
    Rfq: async (id) => (await prisma.rfq.findUnique({ where: { id }, select: { title: true } }))?.title,
    PurchaseOrder: async (id) =>
      (await prisma.purchaseOrder.findUnique({ where: { id }, select: { poNumber: true } }))?.poNumber,
    Bill: async (id) => (await prisma.bill.findUnique({ where: { id }, select: { billNumber: true } }))?.billNumber,
    Vendor: async (id) => (await prisma.vendor.findUnique({ where: { id }, select: { name: true } }))?.name,
    Organization: async (id) => (await prisma.organization.findUnique({ where: { id }, select: { name: true } }))?.name,
    Project: async (id) => (await prisma.project.findUnique({ where: { id }, select: { name: true } }))?.name,
    Business: async (id) => (await prisma.business.findUnique({ where: { id }, select: { code: true } }))?.code,
    User: async (id) => (await prisma.user.findUnique({ where: { id }, select: { email: true } }))?.email,
  };

  return async (entityType, entityId) => (await lookups[entityType]?.(entityId)) ?? null;
}
