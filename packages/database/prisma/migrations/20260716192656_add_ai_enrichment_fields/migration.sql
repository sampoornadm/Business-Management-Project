-- AlterTable
ALTER TABLE "boq_items" ADD COLUMN     "aiCategory" TEXT,
ADD COLUMN     "aiConfidence" DOUBLE PRECISION,
ADD COLUMN     "aiEnrichedAt" TIMESTAMP(3),
ADD COLUMN     "aiRateSourceId" TEXT,
ADD COLUMN     "aiSource" TEXT,
ADD COLUMN     "aiSubcategory" TEXT,
ADD COLUMN     "normalizedName" TEXT,
ADD COLUMN     "suggestedRate" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "historical_rates" ADD COLUMN     "embeddedAt" TIMESTAMP(3),
ADD COLUMN     "embedding" DOUBLE PRECISION[];
