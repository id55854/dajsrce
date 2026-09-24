-- ---------------------------------------------------------------------------
-- 20260924210000_shared_rate_limit.sql
--
-- One bucket store for limits that must hold across serverless instances.
-- The in-memory limiter in the application is per process, so a password
-- guess spread over many instances never reaches the advertised budget.
--
-- Only the service role may call this. Callers pass an opaque key (route
-- name plus address, or a hash), never a raw email or token.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  request_count integer NOT NULL,
  reset_at timestamptz NOT NULL,
  CONSTRAINT rate_limit_buckets_key_bounded CHECK (char_length(bucket_key) BETWEEN 1 AND 200),
  CONSTRAINT rate_limit_buckets_count_positive CHECK (request_count >= 1)
);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.rate_limit_buckets TO service_role;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := pg_catalog.now();
  v_count integer;
  v_reset timestamptz;
  v_window interval;
BEGIN
  IF p_key IS NULL OR char_length(p_key) < 1 OR char_length(p_key) > 200 THEN
    RAISE EXCEPTION 'invalid rate limit key' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100000 THEN
    RAISE EXCEPTION 'invalid rate limit' USING ERRCODE = '22023';
  END IF;
  IF p_window_ms IS NULL OR p_window_ms < 1000 OR p_window_ms > 86400000 THEN
    RAISE EXCEPTION 'invalid rate limit window' USING ERRCODE = '22023';
  END IF;

  v_window := pg_catalog.make_interval(secs => p_window_ms / 1000.0);

  INSERT INTO public.rate_limit_buckets AS bucket (bucket_key, request_count, reset_at)
  VALUES (p_key, 1, v_now + v_window)
  ON CONFLICT (bucket_key) DO UPDATE
    SET request_count = CASE
          WHEN bucket.reset_at <= v_now THEN 1
          ELSE bucket.request_count + 1
        END,
        reset_at = CASE
          WHEN bucket.reset_at <= v_now THEN v_now + v_window
          ELSE bucket.reset_at
        END
  RETURNING request_count, reset_at INTO v_count, v_reset;

  DELETE FROM public.rate_limit_buckets
  WHERE bucket_key IN (
    SELECT expired.bucket_key
    FROM public.rate_limit_buckets AS expired
    WHERE expired.reset_at <= v_now
      AND expired.bucket_key <> p_key
    LIMIT 20
    FOR UPDATE SKIP LOCKED
  );

  RETURN pg_catalog.jsonb_build_object(
    'allowed', v_count <= p_limit,
    'retry_after_seconds', pg_catalog.greatest(
      1,
      pg_catalog.ceil(extract(epoch FROM (v_reset - v_now)))::integer
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer)
  TO service_role;
