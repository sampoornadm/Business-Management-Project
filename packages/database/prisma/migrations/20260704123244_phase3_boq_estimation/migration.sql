-- CreateEnum
CREATE TYPE "BoqStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateEnum
CREATE TYPE "HistoricalRateCategory" AS ENUM ('MATERIAL', 'LABOR', 'MACHINERY', 'TRANSPORT');

-- CreateTable
CREATE TABLE "boqs" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "sourceAttachmentId" TEXT,
    "groupId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "status" "BoqStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_items" (
    "id" TEXT NOT NULL,
    "boqId" TEXT NOT NULL,
    "parentId" TEXT,
    "itemCode" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT,
    "quantity" DOUBLE PRECISION,
    "rate" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "remarks" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_item_rate_breakdowns" (
    "id" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "materialCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "laborCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "machineryCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transportCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overheadPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "profitPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computedRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boq_item_rate_breakdowns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historical_rates" (
    "id" TEXT NOT NULL,
    "category" "HistoricalRateCategory" NOT NULL,
    "itemName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "location" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "sourceTenderId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historical_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "boqs_tenderId_idx" ON "boqs"("tenderId");

-- CreateIndex
CREATE INDEX "boqs_groupId_idx" ON "boqs"("groupId");

-- CreateIndex
CREATE INDEX "boq_items_boqId_idx" ON "boq_items"("boqId");

-- CreateIndex
CREATE INDEX "boq_items_parentId_idx" ON "boq_items"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "boq_item_rate_breakdowns_boqItemId_key" ON "boq_item_rate_breakdowns"("boqItemId");

-- CreateIndex
CREATE INDEX "historical_rates_category_itemName_idx" ON "historical_rates"("category", "itemName");

-- AddForeignKey
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_boqId_fkey" FOREIGN KEY ("boqId") REFERENCES "boqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "boq_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_item_rate_breakdowns" ADD CONSTRAINT "boq_item_rate_breakdowns_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "boq_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_rates" ADD CONSTRAINT "historical_rates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
