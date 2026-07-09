/*
  Warnings:

  - You are about to drop the column `roleId` on the `users` table. All the data in the column will be lost.
  - Added the required column `businessId` to the `bank_accounts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `businessId` to the `boqs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `businessId` to the `expenses` table without a default value. This is not possible if the table is not empty.
  - Added the required column `businessId` to the `goods_receipts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `businessId` to the `historical_rates` table without a default value. This is not possible if the table is not empty.
  - Added the required column `businessId` to the `invoices` table without a default value. This is not possible if the table is not empty.
  - Added the required column `businessId` to the `payments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `businessId` to the `projects` table without a default value. This is not possible if the table is not empty.
  - Added the required column `businessId` to the `purchase_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `activeBusinessId` to the `refresh_tokens` table without a default value. This is not possible if the table is not empty.
  - Added the required column `businessId` to the `rfqs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `businessId` to the `tenders` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_roleId_fkey";

-- DropIndex
DROP INDEX "users_roleId_idx";

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "businessId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "boqs" ADD COLUMN     "businessId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "businessId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "businessId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "historical_rates" ADD COLUMN     "businessId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "businessId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "businessId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "businessId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "businessId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "activeBusinessId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "rfqs" ADD COLUMN     "businessId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "tenders" ADD COLUMN     "businessId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "roleId";

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "gstNumber" TEXT,
    "udyamRegistrationNumber" TEXT,
    "msmeCategory" TEXT,
    "panNumber" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_contacts" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_businesses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_businesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "businesses_code_key" ON "businesses"("code");

-- CreateIndex
CREATE INDEX "businesses_name_idx" ON "businesses"("name");

-- CreateIndex
CREATE INDEX "business_contacts_businessId_idx" ON "business_contacts"("businessId");

-- CreateIndex
CREATE INDEX "user_businesses_businessId_idx" ON "user_businesses"("businessId");

-- CreateIndex
CREATE INDEX "user_businesses_roleId_idx" ON "user_businesses"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_businesses_userId_businessId_key" ON "user_businesses"("userId", "businessId");

-- CreateIndex
CREATE INDEX "bank_accounts_businessId_idx" ON "bank_accounts"("businessId");

-- CreateIndex
CREATE INDEX "boqs_businessId_idx" ON "boqs"("businessId");

-- CreateIndex
CREATE INDEX "expenses_businessId_idx" ON "expenses"("businessId");

-- CreateIndex
CREATE INDEX "goods_receipts_businessId_idx" ON "goods_receipts"("businessId");

-- CreateIndex
CREATE INDEX "historical_rates_businessId_idx" ON "historical_rates"("businessId");

-- CreateIndex
CREATE INDEX "invoices_businessId_idx" ON "invoices"("businessId");

-- CreateIndex
CREATE INDEX "payments_businessId_idx" ON "payments"("businessId");

-- CreateIndex
CREATE INDEX "projects_businessId_idx" ON "projects"("businessId");

-- CreateIndex
CREATE INDEX "purchase_orders_businessId_idx" ON "purchase_orders"("businessId");

-- CreateIndex
CREATE INDEX "rfqs_businessId_idx" ON "rfqs"("businessId");

-- CreateIndex
CREATE INDEX "tenders_businessId_idx" ON "tenders"("businessId");

-- AddForeignKey
ALTER TABLE "business_contacts" ADD CONSTRAINT "business_contacts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_businesses" ADD CONSTRAINT "user_businesses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_businesses" ADD CONSTRAINT "user_businesses_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_businesses" ADD CONSTRAINT "user_businesses_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_activeBusinessId_fkey" FOREIGN KEY ("activeBusinessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historical_rates" ADD CONSTRAINT "historical_rates_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
