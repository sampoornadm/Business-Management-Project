-- Backfill for rate finalization (follows 20261111165031_rate_finalization). Data only, no schema.

-- Item price history on the item page now reads VENDOR HistoricalRate rows. RFQs closed before
-- "Finalize rates" existed never wrote those, so give every priced, non-regretted quote on an
-- already-CLOSED RFQ its row, linked to the RFQ line's inventory Item. A row an old "Push rates to
-- tender" already wrote for the same quote is adopted (itemId set) rather than duplicated.
INSERT INTO "historical_rates" (
  "id", "businessId", "category", "itemName", "unit", "rate", "effectiveDate", "sourceTenderId",
  "vendorId", "rfqQuoteId", "isDefault", "kind", "itemId", "createdById", "embedding"
)
SELECT
  gen_random_uuid()::text, r."businessId", 'MATERIAL', ri."description", COALESCE(ri."unit", 'unit'),
  q."rate", q."quotedAt", r."tenderId", q."vendorId", q."id", q."isSelected", 'VENDOR', ri."itemId",
  r."createdById", '{}'
FROM "rfq_quotes" q
JOIN "rfq_items" ri ON ri."id" = q."rfqItemId"
JOIN "rfqs" r ON r."id" = ri."rfqId"
WHERE r."status" = 'CLOSED' AND q."regretted" = false AND q."rate" IS NOT NULL AND ri."itemId" IS NOT NULL
ON CONFLICT ("rfqQuoteId") DO UPDATE SET "itemId" = EXCLUDED."itemId", "kind" = 'VENDOR';

-- isDefault now means "the quote selected on its own RFQ" (AI rate matching reads these plus
-- hand-entered rates). Old pushed rows had it cleared whenever a newer push named the same item.
UPDATE "historical_rates" h SET "isDefault" = q."isSelected"
FROM "rfq_quotes" q
WHERE q."id" = h."rfqQuoteId";
