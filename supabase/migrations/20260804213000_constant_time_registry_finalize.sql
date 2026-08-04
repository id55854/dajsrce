-- Publication must fit the normal PostgREST statement budget. Membership rows
-- are captured transactionally with each canonical merge, and the batch keeps
-- exact staged/merged/invalid/warning counters, so finalization needs no full
-- table scan.

BEGIN;

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
BEGIN
  SELECT * INTO v_batch
  FROM public.registry_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registry batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_source_rows < 1 OR
     v_batch.rows_staged <> p_expected_source_rows OR
     v_batch.rows_merged <> p_expected_source_rows THEN
    RAISE EXCEPTION 'registry batch is incomplete: staged %, merged %, expected %',
      v_batch.rows_staged, v_batch.rows_merged, p_expected_source_rows
      USING ERRCODE = 'P0001';
  END IF;
  IF v_batch.rows_invalid <> 0 OR EXISTS (
    SELECT 1 FROM public.ngo_registry_staging WHERE batch_id = p_batch_id LIMIT 1
  ) THEN
    RAISE EXCEPTION 'registry batch contains invalid/unmerged rows' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.registry_snapshot_memberships
    WHERE batch_id = p_batch_id LIMIT 1
  ) THEN
    RAISE EXCEPTION 'registry batch has no captured membership' USING ERRCODE = 'P0001';
  END IF;

  -- capture_registry_snapshot_membership runs inside every successful merge
  -- transaction; with unique UDR_ID and rows_merged = expected, membership is
  -- complete before this single-row pointer can move.
  UPDATE public.registry_publication_state
  SET current_batch_id = p_batch_id,
      published_at = now(),
      updated_at = now()
  WHERE singleton = true;

  UPDATE public.registry_import_batches
  SET status = 'completed',
      source_rows = p_expected_source_rows,
      completed_at = coalesce(completed_at, now()),
      updated_at = now(),
      error = NULL
  WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'source_rows', p_expected_source_rows,
    'current_rows', p_expected_source_rows,
    'warning_rows', v_batch.rows_warning,
    'removed_rows', v_batch.removed_rows,
    'source_file_hash', v_batch.source_file_hash
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_registry_import_batch(text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_registry_import_batch(text, bigint) TO service_role;

COMMIT;
