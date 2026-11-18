-- (Prisma's generated DROP INDEX lines for the *_embeddingVector_hnsw_idx pgvector indexes were
-- removed by hand: Prisma sees them as drift. See CLAUDE.md.)

-- CreateTable
CREATE TABLE "competitors" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "vendorCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSelf" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparative_statements" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "rfxNumber" TEXT NOT NULL,
    "description" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "basisOfEvaluation" TEXT,
    "lowestBidId" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comparative_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparative_bids" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "isUs" BOOLEAN NOT NULL DEFAULT false,
    "quotationRef" TEXT NOT NULL,
    "submittedBy" TEXT,
    "total" DOUBLE PRECISION,
    "deliveryText" TEXT,
    "mseStatus" TEXT,
    "answers" JSONB NOT NULL,

    CONSTRAINT "comparative_bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparative_bid_items" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "rfqQuantity" DOUBLE PRECISION,
    "offerQuantity" DOUBLE PRECISION,
    "basicRate" DOUBLE PRECISION NOT NULL,
    "landedRate" DOUBLE PRECISION,
    "boqItemId" TEXT,

    CONSTRAINT "comparative_bid_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "competitors_businessId_vendorCode_key" ON "competitors"("businessId", "vendorCode");

-- CreateIndex
CREATE UNIQUE INDEX "comparative_statements_tenderId_key" ON "comparative_statements"("tenderId");

-- CreateIndex
CREATE INDEX "comparative_statements_businessId_idx" ON "comparative_statements"("businessId");

-- CreateIndex
CREATE INDEX "comparative_bids_businessId_idx" ON "comparative_bids"("businessId");

-- CreateIndex
CREATE INDEX "comparative_bids_competitorId_idx" ON "comparative_bids"("competitorId");

-- CreateIndex
CREATE UNIQUE INDEX "comparative_bids_statementId_competitorId_key" ON "comparative_bids"("statementId", "competitorId");

-- CreateIndex
CREATE INDEX "comparative_bid_items_businessId_itemCode_idx" ON "comparative_bid_items"("businessId", "itemCode");

-- CreateIndex
CREATE INDEX "comparative_bid_items_bidId_idx" ON "comparative_bid_items"("bidId");

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparative_statements" ADD CONSTRAINT "comparative_statements_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparative_statements" ADD CONSTRAINT "comparative_statements_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparative_bids" ADD CONSTRAINT "comparative_bids_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "comparative_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparative_bids" ADD CONSTRAINT "comparative_bids_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "competitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparative_bid_items" ADD CONSTRAINT "comparative_bid_items_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "comparative_bids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparative_bid_items" ADD CONSTRAINT "comparative_bid_items_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "boq_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

