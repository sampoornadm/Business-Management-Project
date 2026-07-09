-- What a vendor sells, for RFQ vendor-suggestion matching. Purely additive.
CREATE TABLE "vendor_item_tags" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "make" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_item_tags_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_item_tags_vendorId_idx" ON "vendor_item_tags"("vendorId");
CREATE INDEX "vendor_item_tags_itemType_idx" ON "vendor_item_tags"("itemType");

ALTER TABLE "vendor_item_tags" ADD CONSTRAINT "vendor_item_tags_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
