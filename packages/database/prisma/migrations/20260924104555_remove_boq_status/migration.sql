-- Removes the BOQ "Finalize" concept: a status flip (DRAFT -> FINALIZED) that was never
-- enforced server-side (every BOQ-editing endpoint worked regardless of status) and only hid
-- the "Add item" form client-side — confusing without providing any real guarantee.
ALTER TABLE "boqs" DROP COLUMN "status";
DROP TYPE "BoqStatus";
