-- The public directory and canonical registry retain only associations that
-- are active in the latest official CTS source. Optional-field warnings (for
-- example a missing OIB) remain publishable so no active official row is lost.

BEGIN;

ALTER TABLE public.registry_import_batches
  ADD COLUMN IF NOT EXISTS mirror_scope text NOT NULL DEFAULT 'complete';

CREATE INDEX IF NOT EXISTS idx_ngo_registry_import_batch_udr_id
  ON public.ngo_registry (import_batch_id, udr_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.registry_import_batches'::regclass
      AND conname = 'registry_import_batches_mirror_scope_check'
  ) THEN
    ALTER TABLE public.registry_import_batches
      ADD CONSTRAINT registry_import_batches_mirror_scope_check
      CHECK (mirror_scope IN ('complete', 'active'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_registry_import_batch(
  p_batch_id text,
  p_expected_source_rows bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch public.registry_import_batches%ROWTYPE;
  v_directory_total bigint;
BEGIN
  SELECT * INTO v_batch FROM public.registry_import_batches
  WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'registry batch not found' USING ERRCODE = 'P0002'; END IF;
  IF p_expected_source_rows < 1 OR v_batch.rows_staged <> p_expected_source_rows OR v_batch.rows_merged <> p_expected_source_rows THEN
    RAISE EXCEPTION 'registry batch is incomplete: staged %, merged %, expected %',
      v_batch.rows_staged, v_batch.rows_merged, p_expected_source_rows USING ERRCODE = 'P0001';
  END IF;
  IF v_batch.rows_invalid <> 0 OR EXISTS (SELECT 1 FROM public.ngo_registry_staging WHERE batch_id = p_batch_id LIMIT 1) THEN
    RAISE EXCEPTION 'registry batch contains invalid/unmerged rows' USING ERRCODE = 'P0001';
  END IF;
  SELECT total INTO v_directory_total FROM public.registry_snapshot_facets WHERE batch_id = p_batch_id;
  IF v_directory_total IS DISTINCT FROM p_expected_source_rows THEN
    RAISE EXCEPTION 'registry directory mismatch: entries %, expected %', v_directory_total, p_expected_source_rows USING ERRCODE = 'P0001';
  END IF;
  IF v_batch.mirror_scope = 'active' AND EXISTS (
    SELECT 1 FROM public.registry_directory_entries
    WHERE batch_id = p_batch_id AND status IS DISTINCT FROM 'AKTIVAN'
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'active registry batch contains a non-active row' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.registry_publication_state
  SET current_batch_id = p_batch_id, published_at = now(), updated_at = now()
  WHERE singleton = true;
  UPDATE public.registry_import_batches
  SET status = 'completed', source_rows = p_expected_source_rows,
      completed_at = coalesce(completed_at, now()), updated_at = now(), error = NULL
  WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'source_rows', p_expected_source_rows, 'current_rows', p_expected_source_rows,
    'warning_rows', v_batch.rows_warning, 'removed_rows', v_batch.removed_rows,
    'source_file_hash', v_batch.source_file_hash, 'mirror_scope', v_batch.mirror_scope
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_registry_import_batch(text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_registry_import_batch(text, bigint)
  TO service_role;

CREATE OR REPLACE FUNCTION public.purge_unpublished_registry_rows_batch(
  p_limit integer DEFAULT 250
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 250), 1000));
  v_current_batch_id text;
  v_outdated_batch_id text;
  v_has_null_batch boolean := false;
  v_deleted integer := 0;
BEGIN
  SELECT state.current_batch_id INTO v_current_batch_id
  FROM public.registry_publication_state state
  WHERE state.singleton = true;

  IF v_current_batch_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.registry_import_batches batch
    WHERE batch.id = v_current_batch_id
      AND batch.status = 'completed'
      AND batch.mirror_scope = 'active'
  ) THEN
    RAISE EXCEPTION 'published registry is not a completed active snapshot' USING ERRCODE = '22023';
  END IF;

  -- Resolve one obsolete import batch first, then use an exact leading-index
  -- lookup. A membership anti-join alone gets slower after every deletion
  -- because it repeatedly scans all surviving active rows.
  SELECT batch.id INTO v_outdated_batch_id
  FROM public.registry_import_batches batch
  WHERE batch.id IS DISTINCT FROM v_current_batch_id
    AND EXISTS (
      SELECT 1
      FROM public.ngo_registry registry
      WHERE registry.import_batch_id = batch.id
        AND NOT EXISTS (
          SELECT 1
          FROM public.registry_snapshot_memberships membership
          WHERE membership.batch_id = v_current_batch_id
            AND membership.udr_id = registry.udr_id
        )
      LIMIT 1
    )
  ORDER BY batch.updated_at, batch.id
  LIMIT 1;

  IF v_outdated_batch_id IS NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.ngo_registry registry
      WHERE registry.import_batch_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.registry_snapshot_memberships membership
          WHERE membership.batch_id = v_current_batch_id
            AND membership.udr_id = registry.udr_id
        )
      LIMIT 1
    ) INTO v_has_null_batch;
  END IF;

  WITH targets AS (
    SELECT registry.udr_id
    FROM public.ngo_registry registry
    WHERE (
        registry.import_batch_id = v_outdated_batch_id
        OR (v_outdated_batch_id IS NULL AND v_has_null_batch AND registry.import_batch_id IS NULL)
      )
      AND NOT EXISTS (
      SELECT 1
      FROM public.registry_snapshot_memberships membership
      WHERE membership.batch_id = v_current_batch_id
        AND membership.udr_id = registry.udr_id
    )
    ORDER BY registry.udr_id
    LIMIT v_limit
    FOR UPDATE OF registry SKIP LOCKED
  )
  DELETE FROM public.ngo_registry registry
  USING targets
  WHERE registry.udr_id = targets.udr_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'deleted', v_deleted,
    'complete', v_deleted = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_unpublished_registry_rows_batch(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_unpublished_registry_rows_batch(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_registry_source_presence_batch(
  p_batch_id text,
  p_limit integer DEFAULT 250
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 250), 1000));
  v_outdated_batch_id text;
  v_enabled integer := 0;
  v_disabled integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.registry_import_batches
    WHERE id = p_batch_id AND status = 'completed' AND mirror_scope = 'active'
  ) THEN
    RAISE EXCEPTION 'registry batch is not a completed active snapshot' USING ERRCODE = '22023';
  END IF;

  WITH targets AS (
    SELECT registry.udr_id
    FROM public.ngo_registry registry
    WHERE registry.source_present = false
      AND registry.import_batch_id = p_batch_id
    ORDER BY registry.udr_id
    LIMIT v_limit
    FOR UPDATE OF registry SKIP LOCKED
  )
  UPDATE public.ngo_registry registry
  SET source_present = true
  FROM targets
  WHERE registry.udr_id = targets.udr_id;
  GET DIAGNOSTICS v_enabled = ROW_COUNT;

  SELECT batch.id INTO v_outdated_batch_id
  FROM public.registry_import_batches batch
  WHERE batch.id IS DISTINCT FROM p_batch_id
    AND EXISTS (
      SELECT 1 FROM public.ngo_registry registry
      WHERE registry.import_batch_id = batch.id AND registry.source_present = true
      LIMIT 1
    )
  ORDER BY batch.updated_at, batch.id
  LIMIT 1;

  WITH targets AS (
    SELECT registry.udr_id
    FROM public.ngo_registry registry
    WHERE registry.source_present = true
      AND (
        registry.import_batch_id = v_outdated_batch_id
        OR (v_outdated_batch_id IS NULL AND registry.import_batch_id IS NULL)
      )
    ORDER BY registry.udr_id
    LIMIT v_limit
    FOR UPDATE OF registry SKIP LOCKED
  )
  UPDATE public.ngo_registry registry
  SET source_present = false
  FROM targets
  WHERE registry.udr_id = targets.udr_id;
  GET DIAGNOSTICS v_disabled = ROW_COUNT;

  RETURN jsonb_build_object(
    'enabled', v_enabled,
    'disabled', v_disabled,
    'complete', v_enabled = 0 AND v_disabled = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_registry_source_presence_batch(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_registry_source_presence_batch(text, integer)
  TO service_role;

COMMIT;
