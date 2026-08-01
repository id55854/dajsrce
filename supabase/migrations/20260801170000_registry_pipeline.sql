-- Resumable registry staging, durable geocoding, classification review, and
-- set-based promotion. Depends on the 15:00 location and 16:00 security gates.

BEGIN;

-- One public institution per registry identity. Preserve the strongest row as
-- canonical and detach duplicate links before adding the invariant.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY registry_oib
           ORDER BY (source = 'curated') DESC, coalesce(is_verified, false) DESC, created_at, id
         ) AS rank
  FROM public.institutions
  WHERE registry_oib IS NOT NULL
)
UPDATE public.institutions i
SET registry_oib = NULL
FROM ranked r
WHERE i.id = r.id AND r.rank > 1;

DROP INDEX IF EXISTS public.idx_institutions_registry_oib;
CREATE UNIQUE INDEX IF NOT EXISTS uq_institutions_registry_oib
  ON public.institutions(registry_oib)
  WHERE registry_oib IS NOT NULL;

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS donation_acceptance_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS classification_version text,
  ADD COLUMN IF NOT EXISTS registry_last_verified_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS location_notifications_enabled boolean NOT NULL DEFAULT false;
GRANT UPDATE (location_notifications_enabled) ON public.profiles TO authenticated;

ALTER TABLE public.ngo_registry
  ADD COLUMN IF NOT EXISTS source_row_number bigint,
  ADD COLUMN IF NOT EXISTS source_file_hash text,
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'valid',
  ADD COLUMN IF NOT EXISTS validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS classification_status text NOT NULL DEFAULT 'unmapped',
  ADD COLUMN IF NOT EXISTS classification_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS classification_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS classification_version text,
  ADD COLUMN IF NOT EXISTS donation_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS geocode_status text,
  ADD COLUMN IF NOT EXISTS geocode_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_geocode_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_geocode_error text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

UPDATE public.ngo_registry
SET geocode_status = CASE
  WHEN lat IS NOT NULL AND lng IS NOT NULL THEN 'succeeded'
  WHEN geocoded_at IS NOT NULL THEN 'retryable_failed'
  ELSE 'pending'
END
WHERE geocode_status IS NULL;
ALTER TABLE public.ngo_registry ALTER COLUMN geocode_status SET DEFAULT 'pending';
ALTER TABLE public.ngo_registry ALTER COLUMN geocode_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ngo_registry_validation_status_known') THEN
    ALTER TABLE public.ngo_registry ADD CONSTRAINT ngo_registry_validation_status_known
      CHECK (validation_status IN ('valid', 'invalid', 'quarantined'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ngo_registry_classification_status_known') THEN
    ALTER TABLE public.ngo_registry ADD CONSTRAINT ngo_registry_classification_status_known
      CHECK (classification_status IN ('unmapped', 'auto_eligible', 'needs_review', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ngo_registry_geocode_status_known') THEN
    ALTER TABLE public.ngo_registry ADD CONSTRAINT ngo_registry_geocode_status_known
      CHECK (geocode_status IN ('pending', 'in_progress', 'succeeded', 'retryable_failed', 'permanent_failed'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_ngo_registry_geocode_queue
  ON public.ngo_registry(geocode_status, next_geocode_attempt_at, oib)
  WHERE geocode_status IN ('pending', 'retryable_failed');
CREATE INDEX IF NOT EXISTS idx_ngo_registry_classification_review
  ON public.ngo_registry(classification_status, mapped_confidence, oib);

CREATE TABLE IF NOT EXISTS public.registry_import_batches (
  id text PRIMARY KEY,
  source_file_hash text NOT NULL,
  source_path text,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'dry_run')),
  last_source_row bigint NOT NULL DEFAULT 0,
  rows_staged bigint NOT NULL DEFAULT 0,
  rows_merged bigint NOT NULL DEFAULT 0,
  rows_invalid bigint NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ngo_registry_staging (
  batch_id text NOT NULL REFERENCES public.registry_import_batches(id) ON DELETE CASCADE,
  source_row_number bigint NOT NULL,
  oib text,
  raw_row_jsonb jsonb NOT NULL,
  normalized_jsonb jsonb,
  validation_status text NOT NULL CHECK (validation_status IN ('valid', 'invalid')),
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  merged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, source_row_number)
);
CREATE INDEX IF NOT EXISTS idx_ngo_registry_staging_merge
  ON public.ngo_registry_staging(batch_id, source_row_number)
  WHERE validation_status = 'valid' AND merged_at IS NULL;

CREATE TABLE IF NOT EXISTS public.registry_review_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oib text NOT NULL REFERENCES public.ngo_registry(oib) ON DELETE CASCADE,
  reason text NOT NULL,
  classification_version text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'merged')),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oib, classification_version)
);

ALTER TABLE public.registry_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ngo_registry_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registry_review_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registry_import_batches, public.ngo_registry_staging, public.registry_review_queue
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.registry_import_batches, public.ngo_registry_staging, public.registry_review_queue
  TO service_role;

CREATE OR REPLACE FUNCTION public.merge_registry_import_batch(
  p_batch_id text,
  p_from_row bigint,
  p_to_row bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_merged bigint := 0;
  v_invalid bigint := 0;
  v_staged bigint := 0;
BEGIN
  INSERT INTO public.ngo_registry(
    oib, mail, naziv, status, udr_id, ciljevi, sjediste, zupanija,
    datum_upisa, web_stranica, datum_statusa, skraceni_naziv,
    ciljane_skupine, opis_djelatnosti, registarski_broj,
    oblik_udruzivanja, gospodarske_djelatnosti, naziv_na_drugim_jezicima,
    datum_osnivacke_skupstine, skr_naziv_na_drugim_jezicima,
    street, city, mapped_category, mapped_confidence, mapped_rule,
    import_batch_id, raw_row_jsonb, source_row_number, source_file_hash,
    validation_status, validation_errors, classification_status,
    classification_reasons, classification_candidates, classification_version,
    donation_candidates, imported_at
  )
  SELECT
    s.oib,
    nullif(s.normalized_jsonb->>'mail', ''),
    s.normalized_jsonb->>'naziv',
    s.normalized_jsonb->>'status',
    nullif(s.normalized_jsonb->>'udr_id', ''),
    nullif(s.normalized_jsonb->>'ciljevi', ''),
    nullif(s.normalized_jsonb->>'sjediste', ''),
    nullif(s.normalized_jsonb->>'zupanija', ''),
    nullif(s.normalized_jsonb->>'datum_upisa', '')::date,
    nullif(s.normalized_jsonb->>'web_stranica', ''),
    nullif(s.normalized_jsonb->>'datum_statusa', '')::date,
    nullif(s.normalized_jsonb->>'skraceni_naziv', ''),
    nullif(s.normalized_jsonb->>'ciljane_skupine', ''),
    nullif(s.normalized_jsonb->>'opis_djelatnosti', ''),
    nullif(s.normalized_jsonb->>'registarski_broj', ''),
    nullif(s.normalized_jsonb->>'oblik_udruzivanja', ''),
    nullif(s.normalized_jsonb->>'gospodarske_djelatnosti', ''),
    nullif(s.normalized_jsonb->>'naziv_na_drugim_jezicima', ''),
    nullif(s.normalized_jsonb->>'datum_osnivacke_skupstine', '')::date,
    nullif(s.normalized_jsonb->>'skr_naziv_na_drugim_jezicima', ''),
    nullif(s.normalized_jsonb->>'street', ''),
    nullif(s.normalized_jsonb->>'city', ''),
    nullif(s.normalized_jsonb->>'mapped_category', ''),
    nullif(s.normalized_jsonb->>'mapped_confidence', '')::numeric,
    nullif(s.normalized_jsonb->>'mapped_rule', ''),
    p_batch_id,
    s.raw_row_jsonb,
    s.source_row_number,
    b.source_file_hash,
    'valid',
    '[]'::jsonb,
    coalesce(s.normalized_jsonb->>'classification_status', 'unmapped'),
    coalesce(s.normalized_jsonb->'classification_reasons', '[]'::jsonb),
    coalesce(s.normalized_jsonb->'classification_candidates', '[]'::jsonb),
    s.normalized_jsonb->>'classification_version',
    coalesce(s.normalized_jsonb->'donation_candidates', '[]'::jsonb),
    now()
  FROM public.ngo_registry_staging s
  JOIN public.registry_import_batches b ON b.id = s.batch_id
  WHERE s.batch_id = p_batch_id
    AND s.source_row_number BETWEEN p_from_row AND p_to_row
    AND s.validation_status = 'valid'
    AND s.merged_at IS NULL
  ON CONFLICT (oib) DO UPDATE SET
    mail = EXCLUDED.mail,
    naziv = EXCLUDED.naziv,
    status = EXCLUDED.status,
    udr_id = EXCLUDED.udr_id,
    ciljevi = EXCLUDED.ciljevi,
    sjediste = EXCLUDED.sjediste,
    zupanija = EXCLUDED.zupanija,
    datum_upisa = EXCLUDED.datum_upisa,
    web_stranica = EXCLUDED.web_stranica,
    datum_statusa = EXCLUDED.datum_statusa,
    skraceni_naziv = EXCLUDED.skraceni_naziv,
    ciljane_skupine = EXCLUDED.ciljane_skupine,
    opis_djelatnosti = EXCLUDED.opis_djelatnosti,
    registarski_broj = EXCLUDED.registarski_broj,
    oblik_udruzivanja = EXCLUDED.oblik_udruzivanja,
    gospodarske_djelatnosti = EXCLUDED.gospodarske_djelatnosti,
    naziv_na_drugim_jezicima = EXCLUDED.naziv_na_drugim_jezicima,
    datum_osnivacke_skupstine = EXCLUDED.datum_osnivacke_skupstine,
    skr_naziv_na_drugim_jezicima = EXCLUDED.skr_naziv_na_drugim_jezicima,
    street = EXCLUDED.street,
    city = EXCLUDED.city,
    mapped_category = EXCLUDED.mapped_category,
    mapped_confidence = EXCLUDED.mapped_confidence,
    mapped_rule = EXCLUDED.mapped_rule,
    import_batch_id = EXCLUDED.import_batch_id,
    raw_row_jsonb = EXCLUDED.raw_row_jsonb,
    source_row_number = EXCLUDED.source_row_number,
    source_file_hash = EXCLUDED.source_file_hash,
    validation_status = EXCLUDED.validation_status,
    validation_errors = EXCLUDED.validation_errors,
    classification_status = EXCLUDED.classification_status,
    classification_reasons = EXCLUDED.classification_reasons,
    classification_candidates = EXCLUDED.classification_candidates,
    classification_version = EXCLUDED.classification_version,
    donation_candidates = EXCLUDED.donation_candidates,
    imported_at = now();
  GET DIAGNOSTICS v_merged = ROW_COUNT;

  UPDATE public.ngo_registry_staging
  SET merged_at = now()
  WHERE batch_id = p_batch_id
    AND source_row_number BETWEEN p_from_row AND p_to_row
    AND validation_status = 'valid';

  SELECT count(*) INTO v_invalid
  FROM public.ngo_registry_staging
  WHERE batch_id = p_batch_id
    AND source_row_number BETWEEN p_from_row AND p_to_row
    AND validation_status = 'invalid';

  SELECT count(*) INTO v_staged
  FROM public.ngo_registry_staging
  WHERE batch_id = p_batch_id
    AND source_row_number BETWEEN p_from_row AND p_to_row;

  UPDATE public.registry_import_batches
  SET last_source_row = greatest(last_source_row, p_to_row),
      rows_staged = rows_staged + v_staged,
      rows_merged = rows_merged + v_merged,
      rows_invalid = rows_invalid + v_invalid,
      updated_at = now()
  WHERE id = p_batch_id;

  RETURN jsonb_build_object('staged', v_staged, 'merged', v_merged, 'invalid', v_invalid);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_registry_classifications(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_changed integer;
BEGIN
  WITH incoming AS (
    SELECT * FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS x(
      oib text,
      mapped_category text,
      mapped_confidence numeric,
      mapped_rule text,
      classification_status text,
      classification_reasons jsonb,
      classification_candidates jsonb,
      classification_version text,
      donation_candidates jsonb
    )
  )
  UPDATE public.ngo_registry r
  SET mapped_category = i.mapped_category,
      mapped_confidence = i.mapped_confidence,
      mapped_rule = i.mapped_rule,
      classification_status = i.classification_status,
      classification_reasons = coalesce(i.classification_reasons, '[]'::jsonb),
      classification_candidates = coalesce(i.classification_candidates, '[]'::jsonb),
      classification_version = i.classification_version,
      donation_candidates = coalesce(i.donation_candidates, '[]'::jsonb)
  FROM incoming i
  WHERE r.oib = i.oib;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  INSERT INTO public.registry_review_queue(oib, reason, classification_version)
  SELECT x.oib,
         coalesce(x.classification_reasons->>0, 'classification requires review'),
         x.classification_version
  FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS x(
    oib text, classification_status text, classification_reasons jsonb, classification_version text
  )
  WHERE x.classification_status = 'needs_review'
  ON CONFLICT (oib, classification_version) DO NOTHING;

  RETURN v_changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_registry_batch(
  p_min_confidence numeric DEFAULT 0.7,
  p_limit integer DEFAULT 500,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_insert integer := 0;
  v_update integer := 0;
  v_link integer := 0;
  v_candidates integer := 0;
BEGIN
  IF p_min_confidence < 0.7 OR p_min_confidence > 1 OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'invalid promotion limits' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE registry_promote_candidates ON COMMIT DROP AS
  SELECT r.*
  FROM public.ngo_registry r
  WHERE r.status = 'AKTIVAN'
    AND r.oblik_udruzivanja IN ('UDRUGA', 'SAVEZ UDRUGA')
    AND r.validation_status = 'valid'
    AND r.classification_status = 'auto_eligible'
    AND r.mapped_category IS NOT NULL
    AND r.mapped_confidence >= p_min_confidence
    AND r.lat IS NOT NULL AND r.lng IS NOT NULL
    AND r.geocode_status = 'succeeded'
    AND r.geocode_confidence IN ('exact', 'street')
  ORDER BY r.oib
  LIMIT p_limit;

  SELECT count(*) INTO v_candidates FROM registry_promote_candidates;
  SELECT count(*) INTO v_link
  FROM registry_promote_candidates c
  WHERE EXISTS (
    SELECT 1 FROM public.institutions i
    WHERE i.source = 'curated' AND (i.registry_oib = c.oib OR i.oib = c.oib)
  );
  SELECT count(*) INTO v_update
  FROM registry_promote_candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.institutions i
    WHERE i.source = 'curated' AND (i.registry_oib = c.oib OR i.oib = c.oib)
  ) AND EXISTS (
    SELECT 1 FROM public.institutions i
    WHERE i.source <> 'curated' AND (i.id = c.institution_id OR i.registry_oib = c.oib)
  );
  v_insert := v_candidates - v_link - v_update;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'candidates', v_candidates, 'would_insert', v_insert,
      'would_update', v_update, 'would_link_curated', v_link
    );
  END IF;

  -- Attach one deterministic curated row without overwriting curated content.
  WITH curated_match AS (
    SELECT c.oib, min(i.id::text)::uuid AS institution_id
    FROM registry_promote_candidates c
    JOIN public.institutions i
      ON i.source = 'curated' AND (i.registry_oib = c.oib OR i.oib = c.oib)
    GROUP BY c.oib
  )
  UPDATE public.institutions i
  SET registry_oib = cm.oib
  FROM curated_match cm
  WHERE i.id = cm.institution_id AND i.registry_oib IS NULL;

  INSERT INTO public.institutions(
    name, category, description, address, city, lat, lng, phone, email, website,
    accepts_donations, served_population, is_verified, is_location_hidden,
    source, registry_oib, oib, donation_acceptance_confirmed,
    classification_version, registry_last_verified_at
  )
  SELECT
    c.naziv,
    c.mapped_category,
    left(coalesce(nullif(c.opis_djelatnosti, ''), c.naziv), 4000),
    coalesce(nullif(c.sjediste, ''), coalesce(c.city, c.zupanija, 'Hrvatska')),
    coalesce(nullif(c.city, ''), regexp_replace(coalesce(c.zupanija, ''), '^Grad\s+', ''), 'Hrvatska'),
    c.lat,
    c.lng,
    NULL,
    c.mail,
    c.web_stranica,
    '{}'::text[],
    left(c.ciljane_skupine, 1000),
    false,
    false,
    'registry',
    c.oib,
    c.oib,
    false,
    c.classification_version,
    coalesce(c.last_verified_at, c.imported_at)
  FROM registry_promote_candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.institutions i
    WHERE i.source = 'curated' AND (i.registry_oib = c.oib OR i.oib = c.oib)
  )
  ON CONFLICT (registry_oib) WHERE registry_oib IS NOT NULL DO UPDATE SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    address = EXCLUDED.address,
    city = EXCLUDED.city,
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    email = EXCLUDED.email,
    website = EXCLUDED.website,
    served_population = EXCLUDED.served_population,
    is_verified = false,
    source = 'registry',
    donation_acceptance_confirmed = false,
    classification_version = EXCLUDED.classification_version,
    registry_last_verified_at = EXCLUDED.registry_last_verified_at
  WHERE institutions.source <> 'curated';

  UPDATE public.ngo_registry r
  SET institution_id = i.id
  FROM registry_promote_candidates c
  JOIN public.institutions i ON i.registry_oib = c.oib
  WHERE r.oib = c.oib;

  RETURN jsonb_build_object(
    'candidates', v_candidates, 'inserted', v_insert,
    'updated', v_update, 'linked_curated', v_link
  );
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
    AND p.lat IS NOT NULL AND p.lng IS NOT NULL
    AND (p_exclude_user_id IS NULL OR p.id <> p_exclude_user_id)
    AND extensions.st_dwithin(
      extensions.st_setsrid(extensions.st_makepoint(p.lng, p.lat), 4326)::extensions.geography,
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
      least(greatest(p_radius_km, 0.1), 50) * 1000
    );
$$;

CREATE OR REPLACE FUNCTION public.registry_coverage_json()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT jsonb_build_object(
    'total', count(*),
    'active', count(*) FILTER (WHERE status = 'AKTIVAN'),
    'mapped', count(*) FILTER (WHERE mapped_category IS NOT NULL),
    'auto_eligible', count(*) FILTER (WHERE classification_status = 'auto_eligible'),
    'needs_review', count(*) FILTER (WHERE classification_status = 'needs_review'),
    'geocoded', count(*) FILTER (WHERE geocode_status = 'succeeded'),
    'promoted', count(*) FILTER (WHERE institution_id IS NOT NULL),
    'by_category', (
      SELECT coalesce(jsonb_object_agg(category, amount), '{}'::jsonb)
      FROM (
        SELECT coalesce(mapped_category, '(unmapped)') category, count(*) amount
        FROM public.ngo_registry GROUP BY 1 ORDER BY 1
      ) c
    ),
    'by_region_promoted', (
      SELECT coalesce(jsonb_object_agg(region, amount), '{}'::jsonb)
      FROM (
        SELECT coalesce(zupanija, '(none)') region, count(*) amount
        FROM public.ngo_registry WHERE institution_id IS NOT NULL GROUP BY 1 ORDER BY 1
      ) z
    )
  )
  FROM public.ngo_registry;
$$;

REVOKE ALL ON FUNCTION public.merge_registry_import_batch(text, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_registry_classifications(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_registry_batch(numeric, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nearby_notification_profile_ids_json(double precision, double precision, double precision, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registry_coverage_json() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_registry_import_batch(text, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_registry_classifications(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_registry_batch(numeric, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.nearby_notification_profile_ids_json(double precision, double precision, double precision, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.registry_coverage_json() TO service_role;

COMMIT;
