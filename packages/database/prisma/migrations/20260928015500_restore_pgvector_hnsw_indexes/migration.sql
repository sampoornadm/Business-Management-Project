-- Restores the three pgvector HNSW indexes that migration
-- 20260915190444_add_hsn_code_gst_to_boq_and_item dropped.
--
-- That migration is the exact failure CLAUDE.md warns about: Prisma's schema DSL cannot express an
-- index on an Unsupported("vector(1024)") column, so a plain `prisma migrate dev` reports the
-- indexes as drift and offers a "corrective" migration. It was accepted, and the DROP INDEX
-- statements shipped. Since then these three ANN queries have fallen back to a full sequential scan:
--
--   items              -> items.repository.findNearestConfirmedMatch (category sibling reuse)
--   historical_rates   -> rates.repository.findNearest               (rate matching)
--   attachments        -> document semantic search
--
-- Results stayed correct (an unindexed pgvector query is an exact scan, so recall actually improves)
-- but the cost grows linearly with the table, which is not what the ANN path was built for.
--
-- IF NOT EXISTS so this is safe to apply to a database that still has them.

CREATE INDEX IF NOT EXISTS "attachments_embeddingVector_hnsw_idx" ON "attachments"
  USING hnsw ("embeddingVector" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "historical_rates_embeddingVector_hnsw_idx" ON "historical_rates"
  USING hnsw ("embeddingVector" vector_cosine_ops);

CREATE INDEX IF NOT EXISTS "items_embeddingVector_hnsw_idx" ON "items"
  USING hnsw ("embeddingVector" vector_cosine_ops);
