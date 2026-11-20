-- Items an Individual-evaluation tender was won on (snapshots of the BOQ lines); [] when the whole
-- tender was won, or it has no Won result.
ALTER TABLE "tenders" ADD COLUMN "wonItems" JSONB NOT NULL DEFAULT '[]';
