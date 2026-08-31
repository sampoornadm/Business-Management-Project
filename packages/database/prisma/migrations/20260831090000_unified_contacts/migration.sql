-- CreateEnum
CREATE TYPE "ContactEntityType" AS ENUM ('ORGANIZATION', 'VENDOR');

-- CreateEnum
CREATE TYPE "ContactLookupKind" AS ENUM ('DEPARTMENT', 'DESIGNATION');

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "entityType" "ContactEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "designation" TEXT,
    "notes" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_phones" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "contact_phones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_emails" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "contact_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_lookup_options" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" "ContactLookupKind" NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_lookup_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_entityType_entityId_idx" ON "contacts"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "contact_phones_contactId_idx" ON "contact_phones"("contactId");

-- CreateIndex
CREATE INDEX "contact_emails_contactId_idx" ON "contact_emails"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "contact_lookup_options_businessId_kind_value_key" ON "contact_lookup_options"("businessId", "kind", "value");

-- CreateIndex
CREATE INDEX "contact_lookup_options_businessId_kind_idx" ON "contact_lookup_options"("businessId", "kind");

-- AddForeignKey
ALTER TABLE "contact_phones" ADD CONSTRAINT "contact_phones_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_emails" ADD CONSTRAINT "contact_emails_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_lookup_options" ADD CONSTRAINT "contact_lookup_options_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: move existing organization_contacts/vendor_contacts rows into the new
-- unified Contact model before dropping the old tables. A temp table maps each old row's id
-- to a freshly generated Contact id, kept stable across the three INSERT statements that need
-- it (a bare `gen_random_uuid()` repeated across separate statements would generate different
-- values each time).
CREATE TEMP TABLE org_contact_id_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id FROM organization_contacts;

INSERT INTO contacts (id, "entityType", "entityId", name, department, designation, notes, "isPrimary", "createdAt", "updatedAt")
SELECT m.new_id, 'ORGANIZATION', oc."organizationId", oc.name, NULL, oc.designation, NULL, oc."isPrimary", oc."createdAt", oc."updatedAt"
FROM organization_contacts oc
JOIN org_contact_id_map m ON m.old_id = oc.id;

INSERT INTO contact_phones (id, "contactId", phone, "isPrimary")
SELECT gen_random_uuid(), m.new_id, oc.phone, true
FROM organization_contacts oc
JOIN org_contact_id_map m ON m.old_id = oc.id
WHERE oc.phone IS NOT NULL AND oc.phone <> '';

INSERT INTO contact_emails (id, "contactId", email, "isPrimary")
SELECT gen_random_uuid(), m.new_id, oc.email, true
FROM organization_contacts oc
JOIN org_contact_id_map m ON m.old_id = oc.id
WHERE oc.email IS NOT NULL AND oc.email <> '';

DROP TABLE org_contact_id_map;

CREATE TEMP TABLE vendor_contact_id_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id FROM vendor_contacts;

INSERT INTO contacts (id, "entityType", "entityId", name, department, designation, notes, "isPrimary", "createdAt", "updatedAt")
SELECT m.new_id, 'VENDOR', vc."vendorId", vc.name, NULL, vc.designation, NULL, vc."isPrimary", vc."createdAt", vc."updatedAt"
FROM vendor_contacts vc
JOIN vendor_contact_id_map m ON m.old_id = vc.id;

INSERT INTO contact_phones (id, "contactId", phone, "isPrimary")
SELECT gen_random_uuid(), m.new_id, vc.phone, true
FROM vendor_contacts vc
JOIN vendor_contact_id_map m ON m.old_id = vc.id
WHERE vc.phone IS NOT NULL AND vc.phone <> '';

INSERT INTO contact_emails (id, "contactId", email, "isPrimary")
SELECT gen_random_uuid(), m.new_id, vc.email, true
FROM vendor_contacts vc
JOIN vendor_contact_id_map m ON m.old_id = vc.id
WHERE vc.email IS NOT NULL AND vc.email <> '';

DROP TABLE vendor_contact_id_map;

-- DropTable
DROP TABLE "organization_contacts";

-- DropTable
DROP TABLE "vendor_contacts";
