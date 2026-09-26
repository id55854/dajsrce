-- Trigram index on the stored folded register text (20260926130000). It
-- replaces the expression index from 20260926111000, which 20260926132000 drops.
--
-- CONCURRENTLY cannot run inside a transaction: apply this file on its own.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_registry_directory_entries_search_fold_col
  ON public.registry_directory_entries
  USING gin (search_fold public.gin_trgm_ops);
