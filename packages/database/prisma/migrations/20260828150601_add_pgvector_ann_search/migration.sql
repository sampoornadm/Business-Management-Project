CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "attachments" ADD COLUMN "embeddingVector" vector(1024);
CREATE INDEX "attachments_embeddingVector_hnsw_idx" ON "attachments"
  USING hnsw ("embeddingVector" vector_cosine_ops);

ALTER TABLE "historical_rates" ADD COLUMN "embeddingVector" vector(1024);
CREATE INDEX "historical_rates_embeddingVector_hnsw_idx" ON "historical_rates"
  USING hnsw ("embeddingVector" vector_cosine_ops);

ALTER TABLE "items" ADD COLUMN "embeddingVector" vector(1024);
CREATE INDEX "items_embeddingVector_hnsw_idx" ON "items"
  USING hnsw ("embeddingVector" vector_cosine_ops);

-- One-time backfill: copy any existing Float[] embeddings into the new column so already-embedded
-- rows aren't invisible to ANN search after cutover.
UPDATE "attachments" SET "embeddingVector" = ('[' || array_to_string(embedding, ',') || ']')::vector
  WHERE "embeddedAt" IS NOT NULL AND array_length(embedding, 1) > 0;
UPDATE "historical_rates" SET "embeddingVector" = ('[' || array_to_string(embedding, ',') || ']')::vector
  WHERE "embeddedAt" IS NOT NULL AND array_length(embedding, 1) > 0;
UPDATE "items" SET "embeddingVector" = ('[' || array_to_string(embedding, ',') || ']')::vector
  WHERE "embeddedAt" IS NOT NULL AND array_length(embedding, 1) > 0;
