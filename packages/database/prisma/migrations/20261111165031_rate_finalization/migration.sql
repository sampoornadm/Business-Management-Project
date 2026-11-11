-- CreateEnum
CREATE TYPE "HistoricalRateKind" AS ENUM ('VENDOR', 'OWN');

-- (Prisma's generated DROP INDEX lines for the four *_embeddingVector_hnsw_idx pgvector indexes
-- were removed by hand: Prisma can't declare those indexes and sees them as drift. See CLAUDE.md.)

-- AlterTable
ALTER TABLE "boq_items" ADD COLUMN     "baseRate" DOUBLE PRECISION,
ADD COLUMN     "baseRateQuoteId" TEXT,
ADD COLUMN     "markupPercent" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "historical_rates" ADD COLUMN     "baseRate" DOUBLE PRECISION,
ADD COLUMN     "itemId" TEXT,
ADD COLUMN     "kind" "HistoricalRateKind" NOT NULL DEFAULT 'VENDOR',
ADD COLUMN     "markupPercent" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "rfq_items" ADD COLUMN     "selectionManual" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tenders" ADD COLUMN     "ratesLockedAt" TIMESTAMP(3),
ADD COLUMN     "ratesLockedById" TEXT,
ADD COLUMN     "submissionReference" TEXT;

-- CreateIndex
CREATE INDEX "historical_rates_itemId_kind_idx" ON "historical_rates"("itemId", "kind");

-- CreateIndex
CREATE INDEX "historical_rates_sourceTenderId_kind_idx" ON "historical_rates"("sourceTenderId", "kind");

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_ratesLockedById_fkey" FOREIGN KEY ("ratesLockedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_baseRateQuoteId_fkey" FOREIGN KEY ("baseRateQuoteId") REFERENCES "rfq_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_rates" ADD CONSTRAINT "historical_rates_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: existing non-draft tenders count as already rates-locked, so the
-- "SUBMITTED requires locked" rule holds for old data.
UPDATE "tenders" SET "ratesLockedAt" = "statusChangedAt" WHERE "status" <> 'DRAFT';

-- Backfill: a selection a human made has an RFQ_QUOTE_SELECTED audit row naming that item.
UPDATE "rfq_items" ri SET "selectionManual" = true
WHERE EXISTS (
  SELECT 1 FROM "audit_logs" a
  WHERE a."action" = 'RFQ_QUOTE_SELECTED' AND a."metadata"->>'rfqItemId' = ri."id"
);

-- Backfill: re-run the auto-pick for every automatic item (lowest priced, non-regretted quote;
-- tie → earliest quotedAt). Fixes selections stuck on the first quote ever entered.
UPDATE "rfq_quotes" q SET "isSelected" = false
FROM "rfq_items" ri WHERE q."rfqItemId" = ri."id" AND ri."selectionManual" = false;
UPDATE "rfq_quotes" q SET "isSelected" = true
FROM (
  SELECT DISTINCT ON (q2."rfqItemId") q2."id"
  FROM "rfq_quotes" q2 JOIN "rfq_items" ri ON ri."id" = q2."rfqItemId"
  WHERE ri."selectionManual" = false AND q2."regretted" = false AND q2."rate" IS NOT NULL
  ORDER BY q2."rfqItemId", q2."rate" ASC, q2."quotedAt" ASC
) lowest WHERE q."id" = lowest."id";
