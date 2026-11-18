-- (Prisma's generated DROP INDEX lines for the *_embeddingVector_hnsw_idx pgvector indexes were
-- removed by hand: Prisma sees them as drift. See CLAUDE.md.)

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "entityCode" TEXT;

-- CreateTable
CREATE TABLE "tender_submissions" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "submissionReference" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "lines" JSONB NOT NULL,
    "changes" JSONB,
    "summary" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tender_submissions_businessId_idx" ON "tender_submissions"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "tender_submissions_tenderId_number_key" ON "tender_submissions"("tenderId", "number");

-- CreateIndex
CREATE INDEX "audit_logs_entityCode_idx" ON "audit_logs"("entityCode");

-- AddForeignKey
ALTER TABLE "tender_submissions" ADD CONSTRAINT "tender_submissions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_submissions" ADD CONSTRAINT "tender_submissions_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_submissions" ADD CONSTRAINT "tender_submissions_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: readable entity codes for existing audit rows (same mapping as AuditService's resolver,
-- modules/audit/entity-code.ts). Rows whose entity no longer exists stay null.
UPDATE "audit_logs" a SET "entityCode" = t."tenderNumber" FROM "tenders" t
  WHERE a."entityType" = 'Tender' AND a."entityId" = t."id";
UPDATE "audit_logs" a SET "entityCode" = t."tenderNumber"
  FROM "boq_items" bi JOIN "boqs" b ON b."id" = bi."boqId" JOIN "tenders" t ON t."id" = b."tenderId"
  WHERE a."entityType" = 'BoqItem' AND a."entityId" = bi."id";
UPDATE "audit_logs" a SET "entityCode" = CASE
    WHEN i."itemCode" ~ '^[0-9]{11}$' THEN substr(i."itemCode", 1, 2) || ' ' || substr(i."itemCode", 3, 2) || ' '
      || substr(i."itemCode", 5, 4) || ' ' || substr(i."itemCode", 9, 3)
    ELSE COALESCE(i."itemCode", i."canonicalName") END
  FROM "items" i WHERE a."entityType" = 'Item' AND a."entityId" = i."id";
UPDATE "audit_logs" a SET "entityCode" = r."title" FROM "rfqs" r
  WHERE a."entityType" = 'Rfq' AND a."entityId" = r."id";
UPDATE "audit_logs" a SET "entityCode" = p."poNumber" FROM "purchase_orders" p
  WHERE a."entityType" = 'PurchaseOrder' AND a."entityId" = p."id";
UPDATE "audit_logs" a SET "entityCode" = b."billNumber" FROM "bills" b
  WHERE a."entityType" = 'Bill' AND a."entityId" = b."id";
UPDATE "audit_logs" a SET "entityCode" = v."name" FROM "vendors" v
  WHERE a."entityType" = 'Vendor' AND a."entityId" = v."id";
UPDATE "audit_logs" a SET "entityCode" = o."name" FROM "organizations" o
  WHERE a."entityType" = 'Organization' AND a."entityId" = o."id";
UPDATE "audit_logs" a SET "entityCode" = p."name" FROM "projects" p
  WHERE a."entityType" = 'Project' AND a."entityId" = p."id";
UPDATE "audit_logs" a SET "entityCode" = b."code" FROM "businesses" b
  WHERE a."entityType" = 'Business' AND a."entityId" = b."id";
UPDATE "audit_logs" a SET "entityCode" = u."email" FROM "users" u
  WHERE a."entityType" = 'User' AND a."entityId" = u."id";

-- Backfill: quote remarks (now "technical deviation") that only mean "no deviation" are cleared —
-- the same whole-text list as modules/rfq/technical-deviation.ts. Text that merely starts with
-- "No" ("No ISI mark on supplied make") is a real deviation and is kept.
UPDATE "rfq_quotes" SET "remarks" = NULL
  WHERE "remarks" IS NOT NULL AND lower(btrim("remarks", E' \t\r\n.,;:!')) IN (
    '', 'no', 'na', 'n/a', 'n.a', 'nil', 'nill', 'none', '-', '--', 'not applicable', 'nd',
    'no deviation', 'no deviations', 'no deviation from spec', 'no deviation from specs',
    'no deviation from specification', 'no deviation from specifications');
