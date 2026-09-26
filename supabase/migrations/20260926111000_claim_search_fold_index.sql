-- Trigram index behind the folded claim search in
-- search_claimable_associations_v1 (20260926110000). Without it every search
-- folds all ~43k register rows (about 1 s); with it the longest query term is
-- an index lookup.
--
-- CONCURRENTLY cannot run inside a transaction: apply this file on its own,
-- not batched with other statements.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_registry_directory_entries_search_fold
  ON public.registry_directory_entries
  USING gin (public.hr_fold(search_text) public.gin_trgm_ops);
