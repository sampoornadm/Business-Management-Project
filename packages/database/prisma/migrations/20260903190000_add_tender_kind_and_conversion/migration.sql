-- CreateEnum
CREATE TYPE "TenderKind" AS ENUM ('TENDER', 'BUDGETARY');

-- AlterTable
ALTER TABLE "tenders" ADD COLUMN     "convertedFromId" TEXT,
ADD COLUMN     "kind" "TenderKind" NOT NULL DEFAULT 'TENDER';

-- CreateIndex
CREATE INDEX "tenders_kind_idx" ON "tenders"("kind");

-- CreateIndex
CREATE INDEX "tenders_convertedFromId_idx" ON "tenders"("convertedFromId");

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_convertedFromId_fkey" FOREIGN KEY ("convertedFromId") REFERENCES "tenders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
