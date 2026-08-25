-- DropIndex
DROP INDEX "notifications_userId_isRead_createdAt_idx";

-- AlterTable (nullable first — existing rows get backfilled below)
ALTER TABLE "notifications" ADD COLUMN     "businessId" TEXT;

-- Backfill: every existing notification is entityType='Tender', so derive
-- businessId from the tender it references.
UPDATE "notifications" n
SET "businessId" = t."businessId"
FROM "tenders" t
WHERE n."entityType" = 'Tender' AND n."entityId" = t.id;

-- AlterTable (now safe to enforce NOT NULL)
ALTER TABLE "notifications" ALTER COLUMN "businessId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "notifications_userId_businessId_isRead_createdAt_idx" ON "notifications"("userId", "businessId", "isRead", "createdAt");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
