-- CreateEnum
CREATE TYPE "PortalBidStatus" AS ENUM ('SAVED', 'SUBMITTED', 'OPENED');

-- AlterTable
ALTER TABLE "boq_items" ADD COLUMN     "unitWeightKg" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "tenders" ADD COLUMN     "deliveryPeriodDays" INTEGER NOT NULL DEFAULT 120;

-- CreateTable
CREATE TABLE "portal_bids" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "portalCode" TEXT NOT NULL,
    "responseNumber" TEXT NOT NULL,
    "status" "PortalBidStatus" NOT NULL DEFAULT 'SAVED',
    "submissionDeadline" TIMESTAMP(3),
    "totalValue" DOUBLE PRECISION,
    "lastFilledAt" TIMESTAMP(3),
    "lastFillSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_profiles" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "portalCode" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_bids_portalCode_responseNumber_key" ON "portal_bids"("portalCode", "responseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "portal_bids_tenderId_portalCode_key" ON "portal_bids"("tenderId", "portalCode");

-- CreateIndex
CREATE UNIQUE INDEX "portal_profiles_businessId_portalCode_key" ON "portal_profiles"("businessId", "portalCode");

-- AddForeignKey
ALTER TABLE "portal_bids" ADD CONSTRAINT "portal_bids_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_bids" ADD CONSTRAINT "portal_bids_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_profiles" ADD CONSTRAINT "portal_profiles_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
