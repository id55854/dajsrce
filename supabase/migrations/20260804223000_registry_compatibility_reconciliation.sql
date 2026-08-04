-- Keep the legacy source_present flag aligned with the atomically published
-- membership pointer. Public reads never depend on this flag, so reconciliation
-- can run in small bounded batches after publication without delaying cutover.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_ngo_registry_source_present_udr_id
  ON public.ngo_registry (source_present, udr_id);

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
  v_enabled integer := 0;
  v_disabled integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.registry_import_batches
    WHERE id = p_batch_id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'registry batch is not completed' USING ERRCODE = '22023';
  END IF;

  WITH targets AS (
    SELECT r.udr_id
    FROM public.registry_snapshot_memberships membership
    JOIN public.ngo_registry r ON r.udr_id = membership.udr_id
    WHERE membership.batch_id = p_batch_id
      AND r.source_present = false
    ORDER BY r.udr_id
    LIMIT v_limit
    FOR UPDATE OF r SKIP LOCKED
  )
  UPDATE public.ngo_registry r
  SET source_present = true
  FROM targets
  WHERE r.udr_id = targets.udr_id;
  GET DIAGNOSTICS v_enabled = ROW_COUNT;

  WITH targets AS (
    SELECT r.udr_id
    FROM public.ngo_registry r
    WHERE r.source_present = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.registry_snapshot_memberships membership
        WHERE membership.batch_id = p_batch_id
          AND membership.udr_id = r.udr_id
      )
    ORDER BY r.udr_id
    LIMIT v_limit
    FOR UPDATE OF r SKIP LOCKED
  )
  UPDATE public.ngo_registry r
  SET source_present = false
  FROM targets
  WHERE r.udr_id = targets.udr_id;
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
