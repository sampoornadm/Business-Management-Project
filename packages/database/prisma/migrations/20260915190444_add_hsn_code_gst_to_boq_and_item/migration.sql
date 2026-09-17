-- DropIndex
DROP INDEX "attachments_embeddingVector_hnsw_idx";

-- DropIndex
DROP INDEX "historical_rates_embeddingVector_hnsw_idx";

-- DropIndex
DROP INDEX "items_embeddingVector_hnsw_idx";

-- AlterTable
ALTER TABLE "boq_items" ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "hsnCodeConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "suggestedGstRate" DOUBLE PRECISION,
ADD COLUMN     "suggestedHsnCode" TEXT;

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "gstRate" DOUBLE PRECISION,
ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "hsnCodeConfirmed" BOOLEAN NOT NULL DEFAULT false;
