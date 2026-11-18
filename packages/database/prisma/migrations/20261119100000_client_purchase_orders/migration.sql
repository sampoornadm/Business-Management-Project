-- CreateTable
CREATE TABLE "client_purchase_orders" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "poDate" TIMESTAMP(3) NOT NULL,
    "deliveryDueDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_purchase_order_items" (
    "id" TEXT NOT NULL,
    "clientPurchaseOrderId" TEXT NOT NULL,
    "boqItemId" TEXT,
    "itemCode" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "client_purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_purchase_orders_projectId_idx" ON "client_purchase_orders"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "client_purchase_orders_businessId_poNumber_key" ON "client_purchase_orders"("businessId", "poNumber");

-- CreateIndex
CREATE INDEX "client_purchase_order_items_clientPurchaseOrderId_idx" ON "client_purchase_order_items"("clientPurchaseOrderId");

-- AddForeignKey
ALTER TABLE "client_purchase_orders" ADD CONSTRAINT "client_purchase_orders_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_purchase_orders" ADD CONSTRAINT "client_purchase_orders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_purchase_orders" ADD CONSTRAINT "client_purchase_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_purchase_order_items" ADD CONSTRAINT "client_purchase_order_items_clientPurchaseOrderId_fkey" FOREIGN KEY ("clientPurchaseOrderId") REFERENCES "client_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
