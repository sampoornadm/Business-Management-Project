-- pgvector applies a query's WHERE predicate AFTER the HNSW index returns its candidate list
-- (hnsw.ef_search, default 40). All three ANN queries in this app filter by a tenant scope
-- (businessId / tenderIds / categoryConfirmed+excludeItemId), so once a tenant's rows are a small
-- fraction of the table, that tenant's true nearest neighbours may not be in the global top-40 at
-- all — the query silently returns fewer rows, or misses the actual best match, with no error.
-- That directly undermines AI_MATCH_THRESHOLD's exact-match guarantee and the item self-exclusion
-- logic. 'strict_order' (pgvector >= 0.8) keeps expanding the scan until it has the true, in-order
-- nearest neighbours within the filtered set — the same correctness the pre-ANN brute-force scan
-- had, at some scan-time cost this app's data size can afford.
--
-- current_database() rather than a hardcoded name: this same migration runs against bmp (dev),
-- bmp_test (test/CI), and whatever production is called, and ALTER DATABASE only affects the
-- database it names. Database-level settings apply to NEW sessions only.
DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET hnsw.iterative_scan = %L',
    current_database(),
    'strict_order'
  );
END
$$;
