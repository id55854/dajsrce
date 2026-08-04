-- Complete, current mirror of the official Croatian Associations Register.
--
-- The official CTS snapshot contains records without OIB and one duplicated
-- OIB, while UDR_ID is present and unique for every source row. UDR_ID is
-- therefore the canonical registry identity; OIB remains optional source data.

BEGIN;

CREATE COLLATION IF NOT EXISTS public.hr_sort (
  provider = icu,
  locale = 'hr-HR-u-kn-true',
  deterministic = false
);

-- Preserve review links while changing the canonical registry key.
ALTER TABLE public.registry_review_queue
  ADD COLUMN IF NOT EXISTS registry_udr_id text;

UPDATE public.registry_review_queue q
SET registry_udr_id = r.udr_id
FROM public.ngo_registry r
WHERE q.registry_udr_id IS NULL AND q.oib = r.oib;

ALTER TABLE public.registry_review_queue
  DROP CONSTRAINT IF EXISTS registry_review_queue_oib_fkey,
  DROP CONSTRAINT IF EXISTS registry_review_queue_oib_classification_version_key;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ngo_registry
    WHERE udr_id IS NULL OR btrim(udr_id) = ''
  ) THEN
    RAISE EXCEPTION 'ngo_registry contains rows without UDR_ID';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ngo_registry GROUP BY udr_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ngo_registry contains duplicate UDR_ID values';
  END IF;
END;
$$;

ALTER TABLE public.ngo_registry DROP CONSTRAINT IF EXISTS ngo_registry_pkey;
ALTER TABLE public.ngo_registry ALTER COLUMN oib DROP NOT NULL;
ALTER TABLE public.ngo_registry ALTER COLUMN udr_id SET NOT NULL;
ALTER TABLE public.ngo_registry ADD CONSTRAINT ngo_registry_pkey PRIMARY KEY (udr_id);

DROP INDEX IF EXISTS public.idx_ngo_registry_classification_review;
CREATE INDEX idx_ngo_registry_classification_review
  ON public.ngo_registry(classification_status, mapped_confidence, udr_id);
CREATE INDEX IF NOT EXISTS idx_ngo_registry_oib
  ON public.ngo_registry(oib) WHERE oib IS NOT NULL;

ALTER TABLE public.registry_review_queue
  ALTER COLUMN registry_udr_id SET NOT NULL,
  ADD CONSTRAINT registry_review_queue_registry_udr_id_fkey
    FOREIGN KEY (registry_udr_id) REFERENCES public.ngo_registry(udr_id) ON DELETE CASCADE,
  ADD CONSTRAINT registry_review_queue_udr_version_key
    UNIQUE (registry_udr_id, classification_version);
ALTER TABLE public.registry_review_queue DROP COLUMN oib;

ALTER TABLE public.ngo_registry_staging
  ADD COLUMN IF NOT EXISTS udr_id text;
UPDATE public.ngo_registry_staging
SET udr_id = nullif(normalized_jsonb->>'udr_id', '')
WHERE udr_id IS NULL;
ALTER TABLE public.ngo_registry_staging
  DROP CONSTRAINT IF EXISTS ngo_registry_staging_validation_status_check;
ALTER TABLE public.ngo_registry_staging
  ADD CONSTRAINT ngo_registry_staging_validation_status_check
    CHECK (validation_status IN ('valid', 'warning', 'invalid'));

ALTER TABLE public.ngo_registry
  DROP CONSTRAINT IF EXISTS ngo_registry_validation_status_known;
ALTER TABLE public.ngo_registry
  ADD CONSTRAINT ngo_registry_validation_status_known
    CHECK (validation_status IN ('valid', 'warning', 'invalid', 'quarantined'));

ALTER TABLE public.registry_import_batches
  ADD COLUMN IF NOT EXISTS source_dataset_id text,
  ADD COLUMN IF NOT EXISTS source_resource_id text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_metadata_modified timestamptz,
  ADD COLUMN IF NOT EXISTS source_bytes bigint,
  ADD COLUMN IF NOT EXISTS source_rows bigint,
  ADD COLUMN IF NOT EXISTS removed_rows bigint NOT NULL DEFAULT 0;

ALTER TABLE public.ngo_registry
  ADD COLUMN IF NOT EXISTS source_present boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source_metadata_modified timestamptz,
  ADD COLUMN IF NOT EXISTS search_text text GENERATED ALWAYS AS (
    lower(
      coalesce(naziv, '') || ' ' ||
      coalesce(skraceni_naziv, '') || ' ' ||
      coalesce(naziv_na_drugim_jezicima, '') || ' ' ||
      coalesce(sjediste, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(zupanija, '') || ' ' ||
      coalesce(registarski_broj, '') || ' ' ||
      coalesce(oib, '') || ' ' ||
      coalesce(udr_id, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_ngo_registry_directory_search
  ON public.ngo_registry USING gin (search_text gin_trgm_ops)
  WHERE source_present;
CREATE INDEX IF NOT EXISTS idx_ngo_registry_directory_name
  ON public.ngo_registry (naziv COLLATE public.hr_sort, udr_id)
  WHERE source_present;
CREATE INDEX IF NOT EXISTS idx_ngo_registry_directory_status_name
  ON public.ngo_registry (status, naziv COLLATE public.hr_sort, udr_id)
  WHERE source_present;
CREATE INDEX IF NOT EXISTS idx_ngo_registry_directory_county_name
  ON public.ngo_registry (zupanija, naziv COLLATE public.hr_sort, udr_id)
  WHERE source_present;
CREATE INDEX IF NOT EXISTS idx_ngo_registry_directory_city_name
  ON public.ngo_registry (city, naziv COLLATE public.hr_sort, udr_id)
  WHERE source_present;
CREATE INDEX IF NOT EXISTS idx_ngo_registry_directory_form_name
  ON public.ngo_registry (oblik_udruzivanja, naziv COLLATE public.hr_sort, udr_id)
  WHERE source_present;
CREATE INDEX IF NOT EXISTS idx_ngo_registry_directory_registered
  ON public.ngo_registry (datum_upisa DESC, udr_id)
  WHERE source_present;

-- Merge bounded staging batches into the complete UDR_ID-keyed mirror. Raw
-- source JSON lives only in the short-lived staging row; the canonical table
-- already stores every official source field and its source hash.
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
  IF p_from_row < 1 OR p_to_row < p_from_row OR p_to_row - p_from_row > 5000 THEN
    RAISE EXCEPTION 'invalid registry merge range' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE validation_status = 'invalid')
  INTO v_staged, v_invalid
  FROM public.ngo_registry_staging
  WHERE batch_id = p_batch_id
    AND source_row_number BETWEEN p_from_row AND p_to_row;

  INSERT INTO public.ngo_registry(
    udr_id, oib, mail, naziv, status, ciljevi, sjediste, zupanija,
    datum_upisa, web_stranica, datum_statusa, skraceni_naziv,
    ciljane_skupine, opis_djelatnosti, registarski_broj,
    oblik_udruzivanja, gospodarske_djelatnosti, naziv_na_drugim_jezicima,
    datum_osnivacke_skupstine, skr_naziv_na_drugim_jezicima,
    street, city, mapped_category, mapped_confidence, mapped_rule,
    import_batch_id, raw_row_jsonb, source_row_number, source_file_hash,
    validation_status, validation_errors, classification_status,
    classification_reasons, classification_candidates, classification_version,
    donation_candidates, imported_at, source_present,
    source_metadata_modified, last_verified_at
  )
  SELECT
    s.udr_id,
    nullif(s.normalized_jsonb->>'oib', ''),
    nullif(s.normalized_jsonb->>'mail', ''),
    s.normalized_jsonb->>'naziv',
    s.normalized_jsonb->>'status',
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
    NULL,
    s.source_row_number,
    b.source_file_hash,
    s.validation_status,
    s.validation_errors,
    coalesce(s.normalized_jsonb->>'classification_status', 'unmapped'),
    coalesce(s.normalized_jsonb->'classification_reasons', '[]'::jsonb),
    coalesce(s.normalized_jsonb->'classification_candidates', '[]'::jsonb),
    s.normalized_jsonb->>'classification_version',
    coalesce(s.normalized_jsonb->'donation_candidates', '[]'::jsonb),
    now(),
    true,
    b.source_metadata_modified,
    coalesce(b.source_metadata_modified, now())
  FROM public.ngo_registry_staging s
  JOIN public.registry_import_batches b ON b.id = s.batch_id
  WHERE s.batch_id = p_batch_id
    AND s.source_row_number BETWEEN p_from_row AND p_to_row
    AND s.validation_status IN ('valid', 'warning')
    AND s.udr_id IS NOT NULL
    AND s.merged_at IS NULL
  ON CONFLICT (udr_id) DO UPDATE SET
    oib = EXCLUDED.oib,
    mail = EXCLUDED.mail,
    naziv = EXCLUDED.naziv,
    status = EXCLUDED.status,
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
    raw_row_jsonb = NULL,
    source_row_number = EXCLUDED.source_row_number,
    source_file_hash = EXCLUDED.source_file_hash,
    validation_status = EXCLUDED.validation_status,
    validation_errors = EXCLUDED.validation_errors,
    classification_status = EXCLUDED.classification_status,
    classification_reasons = EXCLUDED.classification_reasons,
    classification_candidates = EXCLUDED.classification_candidates,
    classification_version = EXCLUDED.classification_version,
    donation_candidates = EXCLUDED.donation_candidates,
    imported_at = now(),
    source_present = true,
    source_metadata_modified = EXCLUDED.source_metadata_modified,
    last_verified_at = EXCLUDED.last_verified_at;
  GET DIAGNOSTICS v_merged = ROW_COUNT;

  UPDATE public.ngo_registry_staging
  SET merged_at = now()
  WHERE batch_id = p_batch_id
    AND source_row_number BETWEEN p_from_row AND p_to_row
    AND validation_status IN ('valid', 'warning')
    AND udr_id IS NOT NULL;

  UPDATE public.registry_import_batches
  SET last_source_row = greatest(last_source_row, p_to_row),
      rows_staged = rows_staged + v_staged,
      rows_merged = rows_merged + v_merged,
      rows_invalid = rows_invalid + v_invalid,
      updated_at = now()
  WHERE id = p_batch_id;

  DELETE FROM public.ngo_registry_staging
  WHERE batch_id = p_batch_id
    AND source_row_number BETWEEN p_from_row AND p_to_row
    AND merged_at IS NOT NULL;

  RETURN jsonb_build_object('staged', v_staged, 'merged', v_merged, 'invalid', v_invalid);
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
  v_removed bigint := 0;
  v_current bigint := 0;
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

  UPDATE public.ngo_registry
  SET source_present = false
  WHERE source_present = true
    AND import_batch_id IS DISTINCT FROM p_batch_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  SELECT count(*) INTO v_current
  FROM public.ngo_registry
  WHERE source_present = true AND import_batch_id = p_batch_id;

  IF v_current <> p_expected_source_rows THEN
    RAISE EXCEPTION 'registry mirror mismatch: current %, expected %',
      v_current, p_expected_source_rows USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.registry_import_batches
  SET status = 'completed',
      source_rows = p_expected_source_rows,
      removed_rows = v_removed,
      completed_at = coalesce(completed_at, now()),
      updated_at = now(),
      error = NULL
  WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'source_rows', p_expected_source_rows,
    'current_rows', v_current,
    'removed_rows', v_removed,
    'source_file_hash', v_batch.source_file_hash
  );
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
      udr_id text,
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
  WHERE r.udr_id = i.udr_id;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  INSERT INTO public.registry_review_queue(registry_udr_id, reason, classification_version)
  SELECT x.udr_id,
         coalesce(x.classification_reasons->>0, 'classification requires review'),
         x.classification_version
  FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS x(
    udr_id text, classification_status text, classification_reasons jsonb, classification_version text
  )
  WHERE x.classification_status = 'needs_review'
  ON CONFLICT (registry_udr_id, classification_version) DO NOTHING;

  RETURN v_changed;
END;
$$;

-- Public directory facets are intentionally small and cacheable. City remains
-- a typed filter to avoid returning thousands of facet values on every call.
CREATE OR REPLACE FUNCTION public.association_registry_facets_v1()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT jsonb_build_object(
    'total', count(*),
    'statuses', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', amount)
        ORDER BY amount DESC, value COLLATE public.hr_sort), '[]'::jsonb)
      FROM (
        SELECT status AS value, count(*) AS amount
        FROM public.ngo_registry WHERE source_present GROUP BY status
      ) grouped
    ),
    'counties', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', amount)
        ORDER BY value COLLATE public.hr_sort), '[]'::jsonb)
      FROM (
        SELECT zupanija AS value, count(*) AS amount
        FROM public.ngo_registry
        WHERE source_present AND zupanija IS NOT NULL
        GROUP BY zupanija
      ) grouped
    ),
    'forms', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', amount)
        ORDER BY amount DESC, value COLLATE public.hr_sort), '[]'::jsonb)
      FROM (
        SELECT oblik_udruzivanja AS value, count(*) AS amount
        FROM public.ngo_registry
        WHERE source_present AND oblik_udruzivanja IS NOT NULL
        GROUP BY oblik_udruzivanja
      ) grouped
    ),
    'snapshot', (
      SELECT jsonb_build_object(
        'metadata_modified', b.source_metadata_modified,
        'imported_at', b.completed_at,
        'source_file_hash', b.source_file_hash,
        'source_resource_id', b.source_resource_id
      )
      FROM public.registry_import_batches b
      WHERE b.status = 'completed'
      ORDER BY b.completed_at DESC NULLS LAST
      LIMIT 1
    )
  )
  FROM public.ngo_registry
  WHERE source_present;
$$;

CREATE OR REPLACE FUNCTION public.search_association_registry_v1(
  p_query text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_county text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_form text DEFAULT NULL,
  p_sort text DEFAULT 'name_asc',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
DECLARE
  v_query text := nullif(btrim(p_query), '');
  v_status text := nullif(btrim(p_status), '');
  v_county text := nullif(btrim(p_county), '');
  v_city text := nullif(btrim(p_city), '');
  v_form text := nullif(btrim(p_form), '');
  v_order text;
  v_total bigint;
  v_items jsonb;
  v_offset integer;
BEGIN
  IF p_page < 1 OR p_page > 10000 OR p_page_size < 1 OR p_page_size > 100 THEN
    RAISE EXCEPTION 'invalid pagination' USING ERRCODE = '22023';
  END IF;
  IF char_length(coalesce(v_query, '')) > 100 OR
     char_length(coalesce(v_status, '')) > 100 OR
     char_length(coalesce(v_county, '')) > 100 OR
     char_length(coalesce(v_city, '')) > 150 OR
     char_length(coalesce(v_form, '')) > 150 THEN
    RAISE EXCEPTION 'registry filter is too long' USING ERRCODE = '22023';
  END IF;

  v_order := CASE p_sort
    WHEN 'name_asc' THEN 'r.naziv COLLATE public.hr_sort ASC, r.udr_id ASC'
    WHEN 'name_desc' THEN 'r.naziv COLLATE public.hr_sort DESC, r.udr_id ASC'
    WHEN 'registered_desc' THEN 'r.datum_upisa DESC NULLS LAST, r.naziv COLLATE public.hr_sort ASC, r.udr_id ASC'
    WHEN 'registered_asc' THEN 'r.datum_upisa ASC NULLS LAST, r.naziv COLLATE public.hr_sort ASC, r.udr_id ASC'
    WHEN 'status_changed_desc' THEN 'r.datum_statusa DESC NULLS LAST, r.naziv COLLATE public.hr_sort ASC, r.udr_id ASC'
    ELSE NULL
  END;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'invalid registry sort' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.ngo_registry r
  WHERE r.source_present
    AND (v_query IS NULL OR r.search_text ILIKE '%' || lower(v_query) || '%')
    AND (v_status IS NULL OR r.status = v_status)
    AND (v_county IS NULL OR r.zupanija = v_county)
    AND (v_city IS NULL OR r.city ILIKE '%' || v_city || '%')
    AND (v_form IS NULL OR r.oblik_udruzivanja = v_form);

  v_offset := (p_page - 1) * p_page_size;
  EXECUTE pg_catalog.format($query$
    SELECT coalesce(jsonb_agg(item), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id', r.udr_id,
        'oib', r.oib,
        'name', r.naziv,
        'short_name', r.skraceni_naziv,
        'status', r.status,
        'address', r.sjediste,
        'city', r.city,
        'county', r.zupanija,
        'registered_on', r.datum_upisa,
        'status_changed_on', r.datum_statusa,
        'registry_number', r.registarski_broj,
        'legal_form', r.oblik_udruzivanja,
        'email', r.mail,
        'website', r.web_stranica,
        'last_verified_at', r.last_verified_at
      ) AS item
      FROM public.ngo_registry r
      WHERE r.source_present
        AND ($1 IS NULL OR r.search_text ILIKE '%%' || lower($1) || '%%')
        AND ($2 IS NULL OR r.status = $2)
        AND ($3 IS NULL OR r.zupanija = $3)
        AND ($4 IS NULL OR r.city ILIKE '%%' || $4 || '%%')
        AND ($5 IS NULL OR r.oblik_udruzivanja = $5)
      ORDER BY %s
      LIMIT $6 OFFSET $7
    ) page_rows
  $query$, v_order)
  INTO v_items
  USING v_query, v_status, v_county, v_city, v_form, p_page_size, v_offset;

  RETURN jsonb_build_object(
    'version', 1,
    'items', v_items,
    'meta', jsonb_build_object(
      'total', v_total,
      'page', p_page,
      'page_size', p_page_size,
      'page_count', CASE WHEN v_total = 0 THEN 0 ELSE ceil(v_total::numeric / p_page_size)::integer END
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_association_registry_entry_v1(p_udr_id text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', r.udr_id,
    'oib', r.oib,
    'name', r.naziv,
    'short_name', r.skraceni_naziv,
    'status', r.status,
    'goals', r.ciljevi,
    'address', r.sjediste,
    'city', r.city,
    'county', r.zupanija,
    'registered_on', r.datum_upisa,
    'website', r.web_stranica,
    'email', r.mail,
    'status_changed_on', r.datum_statusa,
    'target_groups', r.ciljane_skupine,
    'activity_description', r.opis_djelatnosti,
    'registry_number', r.registarski_broj,
    'legal_form', r.oblik_udruzivanja,
    'economic_activities', r.gospodarske_djelatnosti,
    'names_in_other_languages', r.naziv_na_drugim_jezicima,
    'founding_assembly_on', r.datum_osnivacke_skupstine,
    'short_names_in_other_languages', r.skr_naziv_na_drugim_jezicima,
    'last_verified_at', r.last_verified_at,
    'source_metadata_modified', r.source_metadata_modified,
    'source', jsonb_build_object(
      'publisher', 'Ministarstvo pravosuđa, uprave i digitalne transformacije',
      'dataset', 'Registar udruga Republike Hrvatske',
      'dataset_url', 'https://data.gov.hr/ckan/hr/dataset/registar-udruga',
      'license', 'Otvorena dozvola (OD)'
    )
  )
  FROM public.ngo_registry r
  WHERE r.source_present AND r.udr_id = p_udr_id;
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
    'missing_oib', count(*) FILTER (WHERE oib IS NULL),
    'by_status', (
      SELECT coalesce(jsonb_object_agg(value, amount), '{}'::jsonb)
      FROM (
        SELECT status AS value, count(*) AS amount
        FROM public.ngo_registry WHERE source_present GROUP BY status ORDER BY status
      ) grouped
    ),
    'by_category', (
      SELECT coalesce(jsonb_object_agg(category, amount), '{}'::jsonb)
      FROM (
        SELECT coalesce(mapped_category, '(unmapped)') category, count(*) amount
        FROM public.ngo_registry WHERE source_present GROUP BY 1 ORDER BY 1
      ) grouped
    )
  )
  FROM public.ngo_registry
  WHERE source_present;
$$;

REVOKE ALL ON FUNCTION public.merge_registry_import_batch(text, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_registry_import_batch(text, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_registry_classifications(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.association_registry_facets_v1()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_association_registry_v1(text, text, text, text, text, text, integer, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_association_registry_entry_v1(text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registry_coverage_json()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.merge_registry_import_batch(text, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_registry_import_batch(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_registry_classifications(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.association_registry_facets_v1() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_association_registry_v1(text, text, text, text, text, text, integer, integer)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_association_registry_entry_v1(text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.registry_coverage_json() TO service_role;

COMMIT;
