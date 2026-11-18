-- Priceable BOQ lines the tender had when it was won on only some of them, so the list can say
-- "Won · 1 of 4 items". NULL for a whole-tender win and for wins recorded before this column.
ALTER TABLE "tenders" ADD COLUMN "wonItemsTotal" INTEGER;
