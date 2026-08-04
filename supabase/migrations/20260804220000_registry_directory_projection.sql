-- Lean, snapshot-versioned projection for fast public directory reads. The
-- canonical registry keeps long goals/activity fields; list/search requests do
-- not scan or join those wide rows.

BEGIN;

CREATE TABLE IF NOT EXISTS public.registry_directory_entries (
  batch_id text NOT NULL REFERENCES public.registry_import_batches(id) ON DELETE CASCADE,
  udr_id text NOT NULL,
  oib text,
  name text NOT NULL,
  short_name text,
  status text NOT NULL,
  address text,
  city text,
  county text,
  registered_on date,
  status_changed_on date,
  registry_number text,
  legal_form text,
  email text,
  website text,
  last_verified_at timestamptz,
  search_text text NOT NULL,
  PRIMARY KEY (batch_id, udr_id)
);

CREATE TABLE IF NOT EXISTS public.registry_snapshot_facets (
  batch_id text PRIMARY KEY REFERENCES public.registry_import_batches(id) ON DELETE CASCADE,
  total bigint NOT NULL,
  statuses jsonb NOT NULL,
  counties jsonb NOT NULL,
  forms jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.registry_directory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registry_snapshot_facets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registry_directory_entries, public.registry_snapshot_facets
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.registry_directory_entries, public.registry_snapshot_facets TO service_role;

-- The canonical table no longer serves public directory scans.
DROP INDEX IF EXISTS public.idx_ngo_registry_directory_search;
DROP INDEX IF EXISTS public.idx_ngo_registry_directory_name;
DROP INDEX IF EXISTS public.idx_ngo_registry_directory_status_name;
DROP INDEX IF EXISTS public.idx_ngo_registry_directory_county_name;
DROP INDEX IF EXISTS public.idx_ngo_registry_directory_city_name;
DROP INDEX IF EXISTS public.idx_ngo_registry_directory_form_name;
DROP INDEX IF EXISTS public.idx_ngo_registry_directory_registered;

CREATE INDEX IF NOT EXISTS idx_registry_directory_entries_search
  ON public.registry_directory_entries USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_registry_directory_entries_name
  ON public.registry_directory_entries (batch_id, name COLLATE public.hr_sort, udr_id);
CREATE INDEX IF NOT EXISTS idx_registry_directory_entries_status_name
  ON public.registry_directory_entries (batch_id, status, name COLLATE public.hr_sort, udr_id);
CREATE INDEX IF NOT EXISTS idx_registry_directory_entries_county_name
  ON public.registry_directory_entries (batch_id, county, name COLLATE public.hr_sort, udr_id);
CREATE INDEX IF NOT EXISTS idx_registry_directory_entries_city_name
  ON public.registry_directory_entries (batch_id, city, name COLLATE public.hr_sort, udr_id);
CREATE INDEX IF NOT EXISTS idx_registry_directory_entries_form_name
  ON public.registry_directory_entries (batch_id, legal_form, name COLLATE public.hr_sort, udr_id);
CREATE INDEX IF NOT EXISTS idx_registry_directory_entries_registered
  ON public.registry_directory_entries (batch_id, registered_on DESC, udr_id);

CREATE OR REPLACE FUNCTION public.capture_registry_snapshot_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.import_batch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.registry_import_batches b
    WHERE b.id = NEW.import_batch_id AND b.status IN ('running', 'failed')
  ) THEN
    INSERT INTO public.registry_snapshot_memberships(batch_id, udr_id)
    VALUES (NEW.import_batch_id, NEW.udr_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.registry_directory_entries(
      batch_id, udr_id, oib, name, short_name, status, address, city, county,
      registered_on, status_changed_on, registry_number, legal_form, email,
      website, last_verified_at, search_text
    ) VALUES (
      NEW.import_batch_id, NEW.udr_id, NEW.oib, NEW.naziv, NEW.skraceni_naziv,
      NEW.status, NEW.sjediste, NEW.city, NEW.zupanija, NEW.datum_upisa,
      NEW.datum_statusa, NEW.registarski_broj, NEW.oblik_udruzivanja, NEW.mail,
      NEW.web_stranica, NEW.last_verified_at, NEW.search_text
    )
    ON CONFLICT (batch_id, udr_id) DO UPDATE SET
      oib = EXCLUDED.oib,
      name = EXCLUDED.name,
      short_name = EXCLUDED.short_name,
      status = EXCLUDED.status,
      address = EXCLUDED.address,
      city = EXCLUDED.city,
      county = EXCLUDED.county,
      registered_on = EXCLUDED.registered_on,
      status_changed_on = EXCLUDED.status_changed_on,
      registry_number = EXCLUDED.registry_number,
      legal_form = EXCLUDED.legal_form,
      email = EXCLUDED.email,
      website = EXCLUDED.website,
      last_verified_at = EXCLUDED.last_verified_at,
      search_text = EXCLUDED.search_text;
  END IF;
  RETURN NEW;
END;
$$;

-- Bootstrap the current canonical values for all captured memberships.
INSERT INTO public.registry_directory_entries(
  batch_id, udr_id, oib, name, short_name, status, address, city, county,
  registered_on, status_changed_on, registry_number, legal_form, email,
  website, last_verified_at, search_text
)
SELECT
  membership.batch_id, r.udr_id, r.oib, r.naziv, r.skraceni_naziv, r.status,
  r.sjediste, r.city, r.zupanija, r.datum_upisa, r.datum_statusa,
  r.registarski_broj, r.oblik_udruzivanja, r.mail, r.web_stranica,
  r.last_verified_at, r.search_text
FROM public.registry_snapshot_memberships membership
JOIN public.ngo_registry r ON r.udr_id = membership.udr_id
ON CONFLICT (batch_id, udr_id) DO UPDATE SET
  oib = EXCLUDED.oib, name = EXCLUDED.name, short_name = EXCLUDED.short_name,
  status = EXCLUDED.status, address = EXCLUDED.address, city = EXCLUDED.city,
  county = EXCLUDED.county, registered_on = EXCLUDED.registered_on,
  status_changed_on = EXCLUDED.status_changed_on,
  registry_number = EXCLUDED.registry_number, legal_form = EXCLUDED.legal_form,
  email = EXCLUDED.email, website = EXCLUDED.website,
  last_verified_at = EXCLUDED.last_verified_at, search_text = EXCLUDED.search_text;

CREATE OR REPLACE FUNCTION public.refresh_registry_snapshot_facets(p_batch_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_total bigint;
  v_statuses jsonb;
  v_counties jsonb;
  v_forms jsonb;
BEGIN
  SELECT count(*) INTO v_total
  FROM public.registry_directory_entries WHERE batch_id = p_batch_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', amount)
    ORDER BY amount DESC, value COLLATE public.hr_sort), '[]'::jsonb)
  INTO v_statuses
  FROM (SELECT status value, count(*) amount FROM public.registry_directory_entries WHERE batch_id = p_batch_id GROUP BY status) grouped;

  SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', amount)
    ORDER BY value COLLATE public.hr_sort), '[]'::jsonb)
  INTO v_counties
  FROM (SELECT county value, count(*) amount FROM public.registry_directory_entries WHERE batch_id = p_batch_id AND county IS NOT NULL GROUP BY county) grouped;

  SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', amount)
    ORDER BY amount DESC, value COLLATE public.hr_sort), '[]'::jsonb)
  INTO v_forms
  FROM (SELECT legal_form value, count(*) amount FROM public.registry_directory_entries WHERE batch_id = p_batch_id AND legal_form IS NOT NULL GROUP BY legal_form) grouped;

  INSERT INTO public.registry_snapshot_facets(batch_id, total, statuses, counties, forms, generated_at)
  VALUES (p_batch_id, v_total, v_statuses, v_counties, v_forms, now())
  ON CONFLICT (batch_id) DO UPDATE SET
    total = EXCLUDED.total,
    statuses = EXCLUDED.statuses,
    counties = EXCLUDED.counties,
    forms = EXCLUDED.forms,
    generated_at = EXCLUDED.generated_at;

  RETURN jsonb_build_object('batch_id', p_batch_id, 'total', v_total);
END;
$$;

-- Prepare the already-published bootstrap snapshot.
SELECT public.refresh_registry_snapshot_facets(state.current_batch_id)
FROM public.registry_publication_state state
WHERE state.singleton = true AND state.current_batch_id IS NOT NULL;

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
    'source_file_hash', v_batch.source_file_hash
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.association_registry_facets_v1()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT jsonb_build_object(
    'total', facets.total,
    'statuses', facets.statuses,
    'counties', facets.counties,
    'forms', facets.forms,
    'snapshot', jsonb_build_object(
      'metadata_modified', batch.source_metadata_modified,
      'imported_at', batch.completed_at,
      'source_file_hash', batch.source_file_hash,
      'source_resource_id', batch.source_resource_id
    )
  )
  FROM public.registry_publication_state state
  JOIN public.registry_snapshot_facets facets ON facets.batch_id = state.current_batch_id
  JOIN public.registry_import_batches batch ON batch.id = state.current_batch_id
  WHERE state.singleton = true;
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
  v_batch_id text;
  v_query text := nullif(btrim(p_query), '');
  v_status text := nullif(btrim(p_status), '');
  v_county text := nullif(btrim(p_county), '');
  v_city text := nullif(btrim(p_city), '');
  v_form text := nullif(btrim(p_form), '');
  v_order text;
  v_total bigint;
  v_items jsonb;
BEGIN
  IF p_page < 1 OR p_page > 10000 OR p_page_size < 1 OR p_page_size > 100 THEN RAISE EXCEPTION 'invalid pagination' USING ERRCODE = '22023'; END IF;
  IF char_length(coalesce(v_query, '')) > 100 OR char_length(coalesce(v_status, '')) > 100 OR
     char_length(coalesce(v_county, '')) > 100 OR char_length(coalesce(v_city, '')) > 150 OR
     char_length(coalesce(v_form, '')) > 150 THEN RAISE EXCEPTION 'registry filter is too long' USING ERRCODE = '22023'; END IF;
  v_order := CASE p_sort
    WHEN 'name_asc' THEN 'd.name COLLATE public.hr_sort ASC, d.udr_id ASC'
    WHEN 'name_desc' THEN 'd.name COLLATE public.hr_sort DESC, d.udr_id ASC'
    WHEN 'registered_desc' THEN 'd.registered_on DESC NULLS LAST, d.name COLLATE public.hr_sort ASC, d.udr_id ASC'
    WHEN 'registered_asc' THEN 'd.registered_on ASC NULLS LAST, d.name COLLATE public.hr_sort ASC, d.udr_id ASC'
    WHEN 'status_changed_desc' THEN 'd.status_changed_on DESC NULLS LAST, d.name COLLATE public.hr_sort ASC, d.udr_id ASC'
    ELSE NULL END;
  IF v_order IS NULL THEN RAISE EXCEPTION 'invalid registry sort' USING ERRCODE = '22023'; END IF;
  SELECT current_batch_id INTO v_batch_id FROM public.registry_publication_state WHERE singleton = true;

  SELECT count(*) INTO v_total FROM public.registry_directory_entries d
  WHERE d.batch_id = v_batch_id
    AND (v_query IS NULL OR d.search_text ILIKE '%' || lower(v_query) || '%')
    AND (v_status IS NULL OR d.status = v_status)
    AND (v_county IS NULL OR d.county = v_county)
    AND (v_city IS NULL OR d.city ILIKE '%' || v_city || '%')
    AND (v_form IS NULL OR d.legal_form = v_form);

  EXECUTE pg_catalog.format($query$
    SELECT coalesce(jsonb_agg(item), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'id', d.udr_id, 'oib', d.oib, 'name', d.name, 'short_name', d.short_name,
        'status', d.status, 'address', d.address, 'city', d.city, 'county', d.county,
        'registered_on', d.registered_on, 'status_changed_on', d.status_changed_on,
        'registry_number', d.registry_number, 'legal_form', d.legal_form,
        'email', d.email, 'website', d.website, 'last_verified_at', d.last_verified_at
      ) item
      FROM public.registry_directory_entries d
      WHERE d.batch_id = $1
        AND ($2 IS NULL OR d.search_text ILIKE '%%' || lower($2) || '%%')
        AND ($3 IS NULL OR d.status = $3)
        AND ($4 IS NULL OR d.county = $4)
        AND ($5 IS NULL OR d.city ILIKE '%%' || $5 || '%%')
        AND ($6 IS NULL OR d.legal_form = $6)
      ORDER BY %s LIMIT $7 OFFSET $8
    ) page_rows
  $query$, v_order)
  INTO v_items
  USING v_batch_id, v_query, v_status, v_county, v_city, v_form, p_page_size, (p_page - 1) * p_page_size;

  RETURN jsonb_build_object('version', 1, 'items', v_items, 'meta', jsonb_build_object(
    'total', v_total, 'page', p_page, 'page_size', p_page_size,
    'page_count', CASE WHEN v_total = 0 THEN 0 ELSE ceil(v_total::numeric / p_page_size)::integer END));
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
    'id', r.udr_id, 'oib', r.oib, 'name', r.naziv, 'short_name', r.skraceni_naziv,
    'status', r.status, 'goals', r.ciljevi, 'address', r.sjediste, 'city', r.city,
    'county', r.zupanija, 'registered_on', r.datum_upisa, 'website', r.web_stranica,
    'email', r.mail, 'status_changed_on', r.datum_statusa, 'target_groups', r.ciljane_skupine,
    'activity_description', r.opis_djelatnosti, 'registry_number', r.registarski_broj,
    'legal_form', r.oblik_udruzivanja, 'economic_activities', r.gospodarske_djelatnosti,
    'names_in_other_languages', r.naziv_na_drugim_jezicima,
    'founding_assembly_on', r.datum_osnivacke_skupstine,
    'short_names_in_other_languages', r.skr_naziv_na_drugim_jezicima,
    'last_verified_at', r.last_verified_at, 'source_metadata_modified', r.source_metadata_modified,
    'source', jsonb_build_object(
      'publisher', 'Ministarstvo pravosuđa, uprave i digitalne transformacije',
      'dataset', 'Registar udruga Republike Hrvatske',
      'dataset_url', 'https://data.gov.hr/ckan/hr/dataset/registar-udruga',
      'license', 'Otvorena dozvola (OD)')
  )
  FROM public.registry_publication_state state
  JOIN public.registry_directory_entries directory
    ON directory.batch_id = state.current_batch_id AND directory.udr_id = p_udr_id
  JOIN public.ngo_registry r ON r.udr_id = directory.udr_id
  WHERE state.singleton = true;
$$;

REVOKE ALL ON FUNCTION public.refresh_registry_snapshot_facets(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_registry_import_batch(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.association_registry_facets_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_association_registry_v1(text, text, text, text, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_association_registry_entry_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_registry_snapshot_facets(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_registry_import_batch(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.association_registry_facets_v1() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_association_registry_v1(text, text, text, text, text, text, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_association_registry_entry_v1(text) TO anon, authenticated, service_role;

COMMIT;
