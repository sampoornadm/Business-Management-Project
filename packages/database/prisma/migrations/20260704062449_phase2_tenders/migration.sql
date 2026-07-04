-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('GOVERNMENT', 'PRIVATE');

-- CreateEnum
CREATE TYPE "TenderStatus" AS ENUM ('DRAFT', 'UPCOMING', 'DOCUMENT_COLLECTION', 'UNDER_STUDY', 'BOQ_PREPARATION', 'RATE_ANALYSIS', 'APPROVAL_PENDING', 'SUBMITTED', 'TECHNICALLY_QUALIFIED', 'FINANCIALLY_QUALIFIED', 'WON', 'LOST', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TenderPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TenderAssigneeRole" AS ENUM ('OWNER', 'ESTIMATOR', 'REVIEWER', 'OTHER');

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "documentGroupId" TEXT,
ADD COLUMN     "documentType" TEXT,
ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganizationType" NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "gstNumber" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_tags" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenders" (
    "id" TEXT NOT NULL,
    "tenderNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "estimatedCost" DOUBLE PRECISION NOT NULL,
    "emdAmount" DOUBLE PRECISION,
    "tenderFee" DOUBLE PRECISION,
    "documentFee" DOUBLE PRECISION,
    "submissionDate" TIMESTAMP(3) NOT NULL,
    "openingDate" TIMESTAMP(3),
    "validityPeriodDays" INTEGER,
    "status" "TenderStatus" NOT NULL DEFAULT 'DRAFT',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priority" "TenderPriority" NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT,
    "remarks" TEXT,
    "winnerName" TEXT,
    "winningBidAmount" DOUBLE PRECISION,
    "lossReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_assignees" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TenderAssigneeRole" NOT NULL DEFAULT 'OTHER',
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_competitors" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "competitorName" TEXT NOT NULL,
    "bidAmount" DOUBLE PRECISION,
    "isWinningBid" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organizations_name_idx" ON "organizations"("name");

-- CreateIndex
CREATE INDEX "organization_contacts_organizationId_idx" ON "organization_contacts"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "tender_tags_tagId_idx" ON "tender_tags"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "tender_tags_tenderId_tagId_key" ON "tender_tags"("tenderId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "tenders_tenderNumber_key" ON "tenders"("tenderNumber");

-- CreateIndex
CREATE INDEX "tenders_clientId_idx" ON "tenders"("clientId");

-- CreateIndex
CREATE INDEX "tenders_status_idx" ON "tenders"("status");

-- CreateIndex
CREATE INDEX "tenders_submissionDate_idx" ON "tenders"("submissionDate");

-- CreateIndex
CREATE INDEX "tender_assignees_userId_idx" ON "tender_assignees"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tender_assignees_tenderId_userId_key" ON "tender_assignees"("tenderId", "userId");

-- CreateIndex
CREATE INDEX "tender_competitors_tenderId_idx" ON "tender_competitors"("tenderId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_entityType_entityId_idx" ON "notifications"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "attachments_documentGroupId_idx" ON "attachments"("documentGroupId");

-- CreateIndex
CREATE INDEX "attachments_entityType_entityId_documentType_idx" ON "attachments"("entityType", "entityId", "documentType");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_documentGroupId_fkey" FOREIGN KEY ("documentGroupId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_contacts" ADD CONSTRAINT "organization_contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_tags" ADD CONSTRAINT "tender_tags_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_tags" ADD CONSTRAINT "tender_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_assignees" ADD CONSTRAINT "tender_assignees_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_assignees" ADD CONSTRAINT "tender_assignees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_assignees" ADD CONSTRAINT "tender_assignees_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_competitors" ADD CONSTRAINT "tender_competitors_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
