-- AlterTable: add isSelected first, so the data-migration UPDATE below can read/write it.
ALTER TABLE "rfq_quotes" ADD COLUMN     "isSelected" BOOLEAN NOT NULL DEFAULT false;

-- Data migration: preserve today's whole-RFQ awards as per-item selections
-- before AWARDED stops being a valid status. For every RFQ currently
-- AWARDED, mark its awarded vendor's quote as selected on every item that
-- vendor quoted (non-regretted, non-null rate), then move the RFQ to CLOSED.
UPDATE rfq_quotes rq
SET "isSelected" = true
FROM rfqs r, rfq_items ri
WHERE r.status = 'AWARDED'
  AND r."awardedVendorId" IS NOT NULL
  AND ri."rfqId" = r.id
  AND rq."rfqItemId" = ri.id
  AND rq."vendorId" = r."awardedVendorId"
  AND rq.regretted = false
  AND rq.rate IS NOT NULL;

UPDATE rfqs SET status = 'CLOSED' WHERE status = 'AWARDED';

-- AlterEnum: drop AWARDED now that no row references it.
BEGIN;
CREATE TYPE "RfqStatus_new" AS ENUM ('DRAFT', 'SENT', 'CLOSED', 'CANCELLED');
ALTER TABLE "public"."rfqs" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "rfqs" ALTER COLUMN "status" TYPE "RfqStatus_new" USING ("status"::text::"RfqStatus_new");
ALTER TYPE "RfqStatus" RENAME TO "RfqStatus_old";
ALTER TYPE "RfqStatus_new" RENAME TO "RfqStatus";
DROP TYPE "public"."RfqStatus_old";
ALTER TABLE "rfqs" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropForeignKey
ALTER TABLE "rfqs" DROP CONSTRAINT "rfqs_awardedVendorId_fkey";

-- AlterTable
ALTER TABLE "rfqs" DROP COLUMN "awardedVendorId";

-- AlterTable: extend HistoricalRate with vendor/rfqQuote linkage (all-new nullable columns).
ALTER TABLE "historical_rates" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rfqQuoteId" TEXT,
ADD COLUMN     "vendorId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "historical_rates_rfqQuoteId_key" ON "historical_rates"("rfqQuoteId");

-- AddForeignKey
ALTER TABLE "historical_rates" ADD CONSTRAINT "historical_rates_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_rates" ADD CONSTRAINT "historical_rates_rfqQuoteId_fkey" FOREIGN KEY ("rfqQuoteId") REFERENCES "rfq_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
