-- Database-side reconciliation for source warnings and records removed from a
-- later official snapshot. This keeps resumptions independent of process-local
-- duplicate detection and prevents absent rows from entering map promotion.

BEGIN;

ALTER TABLE public.registry_import_batches
  ADD COLUMN IF NOT EXISTS rows_warning bigint NOT NULL DEFAULT 0;

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
  v_removed bigint := 0;
  v_current bigint := 0;
  v_warnings bigint := 0;
BEGIN
  SELECT * INTO v_batch
  FROM public.registry_import_batches
  WHERE id = p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registry batch not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_source_rows < 1 OR v_batch.rows_staged <> p_expected_source_rows THEN
    RAISE EXCEPTION 'registry batch is incomplete: staged %, expected %',
      v_batch.rows_staged, p_expected_source_rows USING ERRCODE = 'P0001';
  END IF;
  IF v_batch.rows_invalid <> 0 OR EXISTS (
    SELECT 1 FROM public.ngo_registry_staging WHERE batch_id = p_batch_id
  ) THEN
    RAISE EXCEPTION 'registry batch contains invalid/unmerged rows' USING ERRCODE = 'P0001';
  END IF;

  -- OIB is not the official row identity. Mark every member of a duplicate
  -- group consistently even when an import resumed after the first member.
  WITH duplicate_oibs AS (
    SELECT oib
    FROM public.ngo_registry
    WHERE import_batch_id = p_batch_id AND oib IS NOT NULL
    GROUP BY oib
    HAVING count(*) > 1
  )
  UPDATE public.ngo_registry r
  SET validation_status = 'warning',
      validation_errors = CASE
        WHEN r.validation_errors ? 'duplicate_oib_in_source' THEN r.validation_errors
        ELSE r.validation_errors || '["duplicate_oib_in_source"]'::jsonb
      END
  FROM duplicate_oibs d
  WHERE r.import_batch_id = p_batch_id AND r.oib = d.oib;

  UPDATE public.ngo_registry
  SET source_present = false,
      validation_status = 'quarantined',
      validation_errors = CASE
        WHEN validation_errors ? 'absent_from_latest_snapshot' THEN validation_errors
        ELSE validation_errors || '["absent_from_latest_snapshot"]'::jsonb
      END
  WHERE source_present = true
    AND import_batch_id IS DISTINCT FROM p_batch_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  SELECT count(*), count(*) FILTER (WHERE validation_status = 'warning')
  INTO v_current, v_warnings
  FROM public.ngo_registry
  WHERE source_present = true AND import_batch_id = p_batch_id;

  IF v_current <> p_expected_source_rows THEN
    RAISE EXCEPTION 'registry mirror mismatch: current %, expected %',
      v_current, p_expected_source_rows USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.registry_import_batches
  SET status = 'completed',
      source_rows = p_expected_source_rows,
      rows_warning = v_warnings,
      removed_rows = v_removed,
      completed_at = coalesce(completed_at, now()),
      updated_at = now(),
      error = NULL
  WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'source_rows', p_expected_source_rows,
    'current_rows', v_current,
    'warning_rows', v_warnings,
    'removed_rows', v_removed,
    'source_file_hash', v_batch.source_file_hash
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_registry_import_batch(text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_registry_import_batch(text, bigint) TO service_role;

COMMIT;
