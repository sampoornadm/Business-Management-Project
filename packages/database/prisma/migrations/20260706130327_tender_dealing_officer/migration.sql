-- Adds Dealing Officer contact fields to tenders, extracted from the
-- IISCO/SAIL "BID INVITATION" template's header table (name/e-mail, and
-- phone for clients whose documents include it). Purely additive, nullable
-- columns — no data remap needed.
ALTER TABLE "tenders" ADD COLUMN "dealingOfficerName" TEXT;
ALTER TABLE "tenders" ADD COLUMN "dealingOfficerEmail" TEXT;
ALTER TABLE "tenders" ADD COLUMN "dealingOfficerPhone" TEXT;
