-- (Generated DROP INDEX lines for the *_embeddingVector_hnsw_idx pgvector indexes removed by hand —
-- Prisma sees them as drift. See CLAUDE.md.)

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "businessId" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_businessId_idx" ON "audit_logs"("businessId");

-- Backfill: the business each existing audit row belongs to, and entity codes for the types the
-- first backfill missed (Invoice / Expense / BankAccount). Same mapping as modules/audit/entity-code.ts.
UPDATE "audit_logs" a SET "businessId" = t."businessId" FROM "tenders" t
  WHERE a."entityType" = 'Tender' AND a."entityId" = t."id";
UPDATE "audit_logs" a SET "businessId" = b."businessId"
  FROM "boq_items" bi JOIN "boqs" b ON b."id" = bi."boqId"
  WHERE a."entityType" = 'BoqItem' AND a."entityId" = bi."id";
UPDATE "audit_logs" a SET "businessId" = i."businessId" FROM "items" i
  WHERE a."entityType" = 'Item' AND a."entityId" = i."id";
UPDATE "audit_logs" a SET "businessId" = r."businessId" FROM "rfqs" r
  WHERE a."entityType" = 'Rfq' AND a."entityId" = r."id";
UPDATE "audit_logs" a SET "businessId" = p."businessId" FROM "purchase_orders" p
  WHERE a."entityType" = 'PurchaseOrder' AND a."entityId" = p."id";
UPDATE "audit_logs" a SET "businessId" = b."businessId" FROM "bills" b
  WHERE a."entityType" = 'Bill' AND a."entityId" = b."id";
UPDATE "audit_logs" a SET "businessId" = p."businessId" FROM "projects" p
  WHERE a."entityType" = 'Project' AND a."entityId" = p."id";
UPDATE "audit_logs" a SET "businessId" = i."businessId", "entityCode" = i."invoiceNumber" FROM "invoices" i
  WHERE a."entityType" = 'Invoice' AND a."entityId" = i."id";
UPDATE "audit_logs" a SET "businessId" = e."businessId", "entityCode" = e."description" FROM "expenses" e
  WHERE a."entityType" = 'Expense' AND a."entityId" = e."id";
UPDATE "audit_logs" a SET "businessId" = ba."businessId", "entityCode" = ba."name" FROM "bank_accounts" ba
  WHERE a."entityType" = 'BankAccount' AND a."entityId" = ba."id";
UPDATE "audit_logs" a SET "businessId" = a."entityId"
  WHERE a."entityType" = 'Business' AND EXISTS (SELECT 1 FROM "businesses" b WHERE b."id" = a."entityId");
-- Rows whose entity is gone inherit the business an earlier row recorded for the same entity.
UPDATE "audit_logs" a SET "businessId" = known."businessId"
  FROM (
    SELECT DISTINCT ON ("entityType", "entityId") "entityType", "entityId", "businessId"
    FROM "audit_logs" WHERE "businessId" IS NOT NULL
    ORDER BY "entityType", "entityId", "createdAt" DESC
  ) known
  WHERE a."businessId" IS NULL AND a."entityType" = known."entityType" AND a."entityId" = known."entityId";
