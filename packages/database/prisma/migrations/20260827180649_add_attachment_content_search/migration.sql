-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "embeddedAt" TIMESTAMP(3),
ADD COLUMN     "embedding" DOUBLE PRECISION[],
ADD COLUMN     "extractedText" TEXT;
