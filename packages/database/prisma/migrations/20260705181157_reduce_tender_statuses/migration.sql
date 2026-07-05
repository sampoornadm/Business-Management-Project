-- Reduce TenderStatus from 14 values to 5 (Draft, Submitted, Won, Lost, Cancelled).
-- Remap existing data BEFORE shrinking the enum type, since Postgres cannot drop
-- enum values in place and live data exists in several of the removed statuses.

-- Step 1: fold every internal prep stage into DRAFT
UPDATE "tenders"
SET "status" = 'DRAFT'
WHERE "status" IN (
  'UPCOMING',
  'DOCUMENT_COLLECTION',
  'UNDER_STUDY',
  'BOQ_PREPARATION',
  'RATE_ANALYSIS',
  'APPROVAL_PENDING'
);

-- Step 2: fold both post-submission qualification stages into SUBMITTED
UPDATE "tenders"
SET "status" = 'SUBMITTED'
WHERE "status" IN (
  'TECHNICALLY_QUALIFIED',
  'FINANCIALLY_QUALIFIED'
);

-- Step 3: fold ARCHIVED into CANCELLED (defensive; no rows today)
UPDATE "tenders"
SET "status" = 'CANCELLED'
WHERE "status" = 'ARCHIVED';

-- Step 4: shrink the enum type itself via rename-recreate-cast
ALTER TYPE "TenderStatus" RENAME TO "TenderStatus_old";

CREATE TYPE "TenderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'WON', 'LOST', 'CANCELLED');

ALTER TABLE "tenders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "tenders" ALTER COLUMN "status" TYPE "TenderStatus" USING ("status"::text::"TenderStatus");
ALTER TABLE "tenders" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

DROP TYPE "TenderStatus_old";
