-- Hand-written (see CLAUDE.md: `migrate dev` would offer to drop the pgvector HNSW indexes).
-- Apply with `prisma migrate deploy`.
ALTER TABLE "items" ADD COLUMN "itemCode" TEXT;
ALTER TABLE "items" ADD COLUMN "familyKey" TEXT;
CREATE UNIQUE INDEX "items_businessId_itemCode_key" ON "items"("businessId", "itemCode");
CREATE INDEX "items_businessId_familyKey_idx" ON "items"("businessId", "familyKey");

ALTER TABLE "boq_items" ADD COLUMN "suggestedHsnSource" TEXT;
