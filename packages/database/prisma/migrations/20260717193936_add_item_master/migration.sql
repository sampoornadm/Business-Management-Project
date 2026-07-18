-- AlterTable
ALTER TABLE "rfq_items" ADD COLUMN     "itemId" TEXT;

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "category" TEXT,
    "subcategory" TEXT,
    "unit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "items_businessId_idx" ON "items"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "items_businessId_canonicalName_key" ON "items"("businessId", "canonicalName");

-- CreateIndex
CREATE INDEX "rfq_items_itemId_idx" ON "rfq_items"("itemId");

-- AddForeignKey
ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
