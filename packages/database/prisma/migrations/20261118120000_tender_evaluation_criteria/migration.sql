-- How the client evaluates bids ("Overall" / "Individual" / other), from the bid document's header.
ALTER TABLE "tenders" ADD COLUMN "evaluationCriteria" TEXT;
