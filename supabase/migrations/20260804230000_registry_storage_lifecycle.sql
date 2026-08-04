-- Keep the full official snapshot within bounded storage. Public reads moved to
-- registry_directory_entries, so the legacy canonical trigram indexes are
-- redundant. City/form name composites do not support the actual ILIKE and
-- low-cardinality access paths well enough to justify their size.

BEGIN;

DROP INDEX IF EXISTS public.idx_ngo_registry_name_trgm;
DROP INDEX IF EXISTS public.idx_ngo_registry_sjediste_trgm;
DROP INDEX IF EXISTS public.idx_registry_directory_entries_city_name;
DROP INDEX IF EXISTS public.idx_registry_directory_entries_form_name;

CREATE INDEX IF NOT EXISTS idx_registry_directory_entries_city_trgm
  ON public.registry_directory_entries USING gin (city gin_trgm_ops)
  WHERE city IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cleanup_registry_snapshot_storage_batch(
  p_limit integer DEFAULT 250
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 250), 1000));
  v_directory_deleted integer := 0;
  v_memberships_deleted integer := 0;
  v_current_batch_id text;
BEGIN
  SELECT current_batch_id INTO v_current_batch_id
  FROM public.registry_publication_state
  WHERE singleton = true;
  IF v_current_batch_id IS NULL THEN
    RAISE EXCEPTION 'registry has no published snapshot' USING ERRCODE = 'P0002';
  END IF;

  WITH targets AS (
    SELECT entries.ctid
    FROM public.registry_directory_entries entries
    WHERE entries.batch_id IS DISTINCT FROM v_current_batch_id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.registry_directory_entries entries
  USING targets
  WHERE entries.ctid = targets.ctid;
  GET DIAGNOSTICS v_directory_deleted = ROW_COUNT;

  WITH targets AS (
    SELECT membership.ctid
    FROM public.registry_snapshot_memberships membership
    WHERE membership.batch_id IS DISTINCT FROM v_current_batch_id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.registry_snapshot_memberships membership
  USING targets
  WHERE membership.ctid = targets.ctid;
  GET DIAGNOSTICS v_memberships_deleted = ROW_COUNT;

  DELETE FROM public.registry_snapshot_facets facets
  WHERE facets.batch_id IS DISTINCT FROM v_current_batch_id
    AND NOT EXISTS (
      SELECT 1 FROM public.registry_directory_entries entries
      WHERE entries.batch_id = facets.batch_id LIMIT 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.registry_snapshot_memberships membership
      WHERE membership.batch_id = facets.batch_id LIMIT 1
    );

  RETURN jsonb_build_object(
    'directory_deleted', v_directory_deleted,
    'memberships_deleted', v_memberships_deleted,
    'complete', v_directory_deleted = 0 AND v_memberships_deleted = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_registry_snapshot_storage_batch(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_registry_snapshot_storage_batch(integer)
  TO service_role;

COMMIT;
