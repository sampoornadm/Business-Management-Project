-- Prepares the category tree to hold the official CBIC tariff taxonomy (chapters -> headings) and
-- gives HSN codes a GST rate.
--
-- Hand-written: Prisma cannot express the pgvector HNSW indexes already on this database, so a plain
-- `prisma migrate dev` treats them as drift and offers a "corrective" migration that drops them.
-- Apply with `prisma migrate deploy` (or `migrate dev --create-only`).

-- Category gains the tariff code (a heading's code IS its HSN code), the verbatim CBIC text, the
-- GST rate and an active flag for chapters the business never buys from.
ALTER TABLE "categories" ADD COLUMN "code" TEXT;
ALTER TABLE "categories" ADD COLUMN "officialDescription" TEXT;
ALTER TABLE "categories" ADD COLUMN "gstRate" DOUBLE PRECISION;
ALTER TABLE "categories" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "categories_code_key" ON "categories"("code");
CREATE INDEX "categories_active_idx" ON "categories"("active");

-- 15 heading descriptions repeat inside a single chapter in the real CBIC data, so a name can no
-- longer identify a row. `code` takes over that job.
DROP INDEX IF EXISTS "categories_parentId_name_key";

-- CBIC's HSN sheet carries descriptions only; rates come from the lookup sheet.
ALTER TABLE "hsn_codes" ADD COLUMN "gstRate" DOUBLE PRECISION;
ALTER TABLE "hsn_codes" ADD COLUMN "gstRateSource" TEXT;
