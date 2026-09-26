-- Nothing queries hr_fold(search_text) any more (20260926130000 moved every
-- search to the stored search_fold column), so its expression index from
-- 20260926111000 only costs writes.
--
-- CONCURRENTLY cannot run inside a transaction: apply this file on its own.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_registry_directory_entries_search_fold;
