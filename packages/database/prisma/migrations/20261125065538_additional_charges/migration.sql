-- AlterTable
ALTER TABLE "boq_items" ADD COLUMN     "chargeLoad" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "rfq_charges" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "vendorId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "addToRates" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rfq_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_charges" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "vendorId" TEXT,
    "sourceRfqId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "addToRates" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rfq_charges_rfqId_idx" ON "rfq_charges"("rfqId");

-- CreateIndex
CREATE INDEX "tender_charges_tenderId_idx" ON "tender_charges"("tenderId");

-- AddForeignKey
ALTER TABLE "rfq_charges" ADD CONSTRAINT "rfq_charges_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_charges" ADD CONSTRAINT "rfq_charges_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_charges" ADD CONSTRAINT "tender_charges_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_charges" ADD CONSTRAINT "tender_charges_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
