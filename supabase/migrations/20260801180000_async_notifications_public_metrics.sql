-- Durable nearby-notification outbox and evidence-grade public metrics.
-- Depends on the PostGIS location fast path and transactional evidence RPCs.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS location extensions.geography(Point, 4326)
    GENERATED ALWAYS AS (
      CASE
        WHEN lat IS NULL OR lng IS NULL THEN NULL
        ELSE extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography
      END
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_profiles_location_notifications_gist
  ON public.profiles USING gist (location)
  WHERE location_notifications_enabled = true AND location IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  origin_lat double precision NOT NULL CHECK (origin_lat BETWEEN -90 AND 90),
  origin_lng double precision NOT NULL CHECK (origin_lng BETWEEN -180 AND 180),
  radius_km double precision NOT NULL DEFAULT 3 CHECK (radius_km BETWEEN 0.1 AND 50),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  link text,
  exclude_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'failed', 'succeeded', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  delivered_count integer NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_claim
  ON public.notification_jobs(status, next_attempt_at, created_at)
  WHERE status IN ('queued', 'failed', 'processing');

ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_jobs TO service_role;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS delivery_job_id uuid
    REFERENCES public.notification_jobs(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_delivery_job_user
  ON public.notifications(delivery_job_id, user_id);

-- A browser may only mark its own rows read. In particular it cannot forge
-- delivery_job_id values to block the outbox uniqueness key or rewrite links.
REVOKE INSERT, UPDATE, DELETE ON public.notifications FROM anon, authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_nearby_notification(
  p_idempotency_key text,
  p_lat double precision,
  p_lng double precision,
  p_title text,
  p_body text,
  p_link text DEFAULT NULL,
  p_exclude_user_id uuid DEFAULT NULL,
  p_radius_km double precision DEFAULT 3
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) NOT BETWEEN 3 AND 240
     OR p_lat IS NULL OR p_lat NOT BETWEEN -90 AND 90
     OR p_lng IS NULL OR p_lng NOT BETWEEN -180 AND 180
     OR p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 1 AND 200
     OR p_body IS NULL OR length(trim(p_body)) NOT BETWEEN 1 AND 2000
     OR p_radius_km IS NULL OR p_radius_km NOT BETWEEN 0.1 AND 50
     OR (p_link IS NOT NULL AND length(p_link) > 1000) THEN
    RAISE EXCEPTION 'invalid notification job' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notification_jobs(
    idempotency_key, origin_lat, origin_lng, radius_km,
    title, body, link, exclude_user_id
  ) VALUES (
    trim(p_idempotency_key), p_lat, p_lng, p_radius_km,
    trim(p_title), trim(p_body), p_link, p_exclude_user_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM public.notification_jobs
    WHERE idempotency_key = trim(p_idempotency_key);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_notification_job()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_job public.notification_jobs%ROWTYPE;
BEGIN
  -- A worker that dies during its final lease must not strand the row in
  -- processing forever merely because it has exhausted the retry budget.
  UPDATE public.notification_jobs
  SET status = 'dead',
      completed_at = now(),
      last_error = coalesce(last_error, 'worker lease expired after final attempt'),
      updated_at = now()
  WHERE status = 'processing'
    AND attempt_count >= 5
    AND claimed_at < now() - interval '10 minutes';

  SELECT * INTO v_job
  FROM public.notification_jobs
  WHERE (
      (status IN ('queued', 'failed') AND next_attempt_at <= now())
      OR (status = 'processing' AND claimed_at < now() - interval '10 minutes')
    )
    AND attempt_count < 5
  ORDER BY next_attempt_at, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.notification_jobs
  SET status = 'processing',
      attempt_count = attempt_count + 1,
      claimed_at = now(),
      last_error = NULL,
      updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN to_jsonb(v_job);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_notification_job(
  p_job_id uuid,
  p_succeeded boolean,
  p_delivered_count integer DEFAULT 0,
  p_error text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
BEGIN
  UPDATE public.notification_jobs
  SET status = CASE
        WHEN p_succeeded THEN 'succeeded'
        WHEN attempt_count >= 5 THEN 'dead'
        ELSE 'failed'
      END,
      delivered_count = CASE WHEN p_succeeded THEN greatest(0, p_delivered_count) ELSE delivered_count END,
      completed_at = CASE WHEN p_succeeded OR attempt_count >= 5 THEN now() ELSE NULL END,
      next_attempt_at = CASE
        WHEN p_succeeded OR attempt_count >= 5 THEN next_attempt_at
        WHEN attempt_count = 1 THEN now() + interval '1 minute'
        WHEN attempt_count = 2 THEN now() + interval '5 minutes'
        WHEN attempt_count = 3 THEN now() + interval '30 minutes'
        ELSE now() + interval '2 hours'
      END,
      last_error = CASE WHEN p_succeeded THEN NULL ELSE left(coalesce(p_error, 'unknown failure'), 2000) END,
      updated_at = now()
  WHERE id = p_job_id AND status = 'processing'
  RETURNING status INTO v_status;

  IF NOT FOUND THEN RAISE EXCEPTION 'notification job is not processing' USING ERRCODE = '23514'; END IF;
  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.nearby_notification_profile_ids_json(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision DEFAULT 3,
  p_exclude_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
STABLE
AS $$
  SELECT coalesce(jsonb_agg(p.id ORDER BY p.id), '[]'::jsonb)
  FROM public.profiles p
  WHERE p.role = 'individual'
    AND p.location_notifications_enabled = true
    AND p.location IS NOT NULL
    AND (p_exclude_user_id IS NULL OR p.id <> p_exclude_user_id)
    AND extensions.st_dwithin(
      p.location,
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
      least(greatest(p_radius_km, 0.1), 50) * 1000
    );
$$;

REVOKE ALL ON FUNCTION public.enqueue_nearby_notification(text, double precision, double precision, text, text, text, uuid, double precision) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_notification_job() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_notification_job(uuid, boolean, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nearby_notification_profile_ids_json(double precision, double precision, double precision, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_nearby_notification(text, double precision, double precision, text, text, text, uuid, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_notification_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_notification_job(uuid, boolean, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nearby_notification_profile_ids_json(double precision, double precision, double precision, uuid) TO service_role;

-- Public impact numbers are acknowledgement-backed. A delivered-but-unverified
-- pledge is never represented as confirmed public impact.
CREATE OR REPLACE FUNCTION public.get_public_company_bundle(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
DECLARE
  c RECORD;
  v_metrics jsonb;
  v_campaigns jsonb;
  v_report jsonb;
  v_stories jsonb;
BEGIN
  SELECT id, slug, display_name, legal_name, tagline, logo_url,
         brand_primary_hex, brand_secondary_hex, social,
         subscription_tier, public_profile_enabled
  INTO c
  FROM public.companies
  WHERE slug = p_slug;

  IF NOT FOUND OR NOT (
    c.public_profile_enabled = true
    AND c.subscription_tier IN ('sme_plus', 'enterprise')
  ) THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'total_given_eur', coalesce((
      SELECT sum(p.amount_eur)
      FROM public.pledges p
      JOIN public.pledge_acknowledgements a ON a.pledge_id = p.id
      WHERE p.company_id = c.id AND p.amount_eur IS NOT NULL AND p.amount_eur > 0
    ), 0),
    'volunteer_hours', coalesce((
      SELECT sum(vh.hours) FROM public.volunteer_hours vh WHERE vh.company_id = c.id
    ), 0),
    'institutions_supported', coalesce((
      SELECT count(DISTINCT n.institution_id)
      FROM public.pledges p
      JOIN public.pledge_acknowledgements a ON a.pledge_id = p.id
      JOIN public.needs n ON n.id = p.need_id
      WHERE p.company_id = c.id
    ), 0)::bigint,
    'evidence_basis', 'acknowledged_pledges_and_recorded_volunteer_hours'
  ) INTO v_metrics;

  v_campaigns := coalesce((
    SELECT jsonb_agg(jsonb_build_object('name', q.name, 'slug', q.slug, 'sdg_tags', q.sdg_tags) ORDER BY q.created_at DESC)
    FROM (
      SELECT name, slug, sdg_tags, created_at FROM public.campaigns
      WHERE company_id = c.id AND is_active = true
      ORDER BY created_at DESC LIMIT 12
    ) q
  ), '[]'::jsonb);

  v_report := (
    SELECT to_jsonb(r) FROM (
      SELECT id, period_start, period_end, generated_at
      FROM public.company_csr_reports
      WHERE company_id = c.id AND generation_status = 'ready'
      ORDER BY generated_at DESC LIMIT 1
    ) r
  );

  v_stories := coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'institution_name', i.name,
      'description', left(coalesce(i.description, ''), 400)
    ))
    FROM (
      SELECT n.institution_id, sum(p.amount_eur) AS total_eur
      FROM public.pledges p
      JOIN public.pledge_acknowledgements a ON a.pledge_id = p.id
      JOIN public.needs n ON n.id = p.need_id
      WHERE p.company_id = c.id AND p.amount_eur IS NOT NULL AND p.amount_eur > 0
      GROUP BY n.institution_id ORDER BY total_eur DESC LIMIT 2
    ) tops
    JOIN public.institutions i ON i.id = tops.institution_id
  ), '[]'::jsonb);

  RETURN jsonb_build_object(
    'company', jsonb_build_object(
      'id', c.id, 'slug', c.slug, 'display_name', c.display_name,
      'legal_name', c.legal_name, 'tagline', c.tagline,
      'logo_url', c.logo_url, 'brand_primary_hex', c.brand_primary_hex,
      'brand_secondary_hex', c.brand_secondary_hex, 'social', c.social
    ),
    'metrics', v_metrics,
    'campaigns', v_campaigns,
    'latest_report', v_report,
    'stories', v_stories
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_company_bundle(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_company_bundle(text) TO anon, authenticated;

-- Older RLS helpers are still part of the policy graph. Lock their resolution
-- path even though application roles also lost CREATE on the public schema.
ALTER FUNCTION public.current_user_company_member(uuid) SET search_path = pg_catalog, public;
ALTER FUNCTION public.current_user_company_staff(uuid) SET search_path = pg_catalog, public;
ALTER FUNCTION public.current_user_company_finance_access(uuid) SET search_path = pg_catalog, public;
ALTER FUNCTION public.current_user_institution_id() SET search_path = pg_catalog, public;
ALTER FUNCTION public.ngo_sees_volunteer_profile(uuid) SET search_path = pg_catalog, public;
ALTER FUNCTION public.ngo_owns_volunteer_event(uuid) SET search_path = pg_catalog, public;

COMMIT;
