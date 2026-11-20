-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "boqItemId" TEXT;

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientPurchaseOrderId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "ewayBillNumber" TEXT,
    "ewayBillDate" TIMESTAMP(3),
    "vehicleNumber" TEXT,
    "transporterName" TEXT,
    "freightCost" DOUBLE PRECISION,
    "dispatchedAt" TIMESTAMP(3),
    "grnNumber" TEXT,
    "grnDate" TIMESTAMP(3),
    "billId" TEXT,
    "settledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_items" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "clientPoItemId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipments_billId_key" ON "shipments"("billId");

-- CreateIndex
CREATE INDEX "shipments_businessId_idx" ON "shipments"("businessId");

-- CreateIndex
CREATE INDEX "shipments_clientPurchaseOrderId_idx" ON "shipments"("clientPurchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_projectId_number_key" ON "shipments"("projectId", "number");

-- CreateIndex
CREATE INDEX "shipment_items_clientPoItemId_idx" ON "shipment_items"("clientPoItemId");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_items_shipmentId_clientPoItemId_key" ON "shipment_items"("shipmentId", "clientPoItemId");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_clientPurchaseOrderId_fkey" FOREIGN KEY ("clientPurchaseOrderId") REFERENCES "client_purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_clientPoItemId_fkey" FOREIGN KEY ("clientPoItemId") REFERENCES "client_purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: a PO raised from an RFQ copied each RFQ line's description, so its BOQ line is the
-- one RFQ line of that RFQ with the same description. Ambiguous matches are left null.
UPDATE "purchase_order_items" AS poi
SET "boqItemId" = match."boqItemId"
FROM (
    SELECT poi2."id" AS "poItemId", MIN(ri."boqItemId") AS "boqItemId"
    FROM "purchase_order_items" poi2
    JOIN "purchase_orders" po ON po."id" = poi2."purchaseOrderId"
    JOIN "rfq_items" ri ON ri."rfqId" = po."sourceRfqId" AND ri."description" = poi2."description"
    WHERE ri."boqItemId" IS NOT NULL
    GROUP BY poi2."id"
    HAVING COUNT(DISTINCT ri."boqItemId") = 1
) AS match
WHERE poi."id" = match."poItemId";
