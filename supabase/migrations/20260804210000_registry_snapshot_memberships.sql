-- Constant-time atomic publication for complete registry snapshots.
-- Canonical organisation fields are upserted in place, while a compact batch
-- membership table preserves snapshot membership until one pointer is flipped.

BEGIN;

CREATE TABLE IF NOT EXISTS public.registry_snapshot_memberships (
  batch_id text NOT NULL REFERENCES public.registry_import_batches(id) ON DELETE CASCADE,
  udr_id text NOT NULL REFERENCES public.ngo_registry(udr_id) ON DELETE CASCADE,
  PRIMARY KEY (batch_id, udr_id)
);

CREATE TABLE IF NOT EXISTS public.registry_publication_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  current_batch_id text REFERENCES public.registry_import_batches(id) ON DELETE RESTRICT,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.registry_publication_state(singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.registry_snapshot_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registry_publication_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registry_snapshot_memberships, public.registry_publication_state
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.registry_snapshot_memberships, public.registry_publication_state TO service_role;

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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_registry_snapshot_membership_trigger ON public.ngo_registry;
CREATE TRIGGER capture_registry_snapshot_membership_trigger
  AFTER INSERT OR UPDATE OF import_batch_id
  ON public.ngo_registry
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_registry_snapshot_membership();

REVOKE ALL ON FUNCTION public.capture_registry_snapshot_membership()
  FROM PUBLIC, anon, authenticated;

-- Bootstrap any in-progress/completed imports created before the trigger.
INSERT INTO public.registry_snapshot_memberships(batch_id, udr_id)
SELECT r.import_batch_id, r.udr_id
FROM public.ngo_registry r
JOIN public.registry_import_batches b ON b.id = r.import_batch_id
WHERE r.import_batch_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE VIEW public.current_association_registry
WITH (security_barrier = true)
AS
SELECT r.*
FROM public.ngo_registry r
CROSS JOIN public.registry_publication_state state
LEFT JOIN public.registry_snapshot_memberships membership
  ON membership.batch_id = state.current_batch_id
 AND membership.udr_id = r.udr_id
WHERE CASE
  WHEN state.current_batch_id IS NULL THEN r.source_present
  ELSE membership.udr_id IS NOT NULL
END;

REVOKE ALL ON public.current_association_registry FROM PUBLIC, anon, authenticated;

-- Full-table indexes support whichever compact snapshot membership is current.
DROP INDEX IF EXISTS public.idx_ngo_registry_directory_search;
DROP INDEX IF EXISTS public.idx_ngo_registry_directory_name;
DROP INDEX IF EXISTS public.idx_ngo_registry_directory_status_name;
DROP INDEX IF EXISTS public.idx_ngo_registry_directory_county_name;
DROP INDEX IF EXISTS public.idx_ngo_registry_directory_city_name;
DROP INDEX IF EXISTS public.idx_ngo_registry_directory_form_name;
DROP INDEX IF EXISTS public.idx_ngo_registry_directory_registered;

CREATE INDEX idx_ngo_registry_directory_search
  ON public.ngo_registry USING gin (search_text gin_trgm_ops);
CREATE INDEX idx_ngo_registry_directory_name
  ON public.ngo_registry (naziv COLLATE public.hr_sort, udr_id);
CREATE INDEX idx_ngo_registry_directory_status_name
  ON public.ngo_registry (status, naziv COLLATE public.hr_sort, udr_id);
CREATE INDEX idx_ngo_registry_directory_county_name
  ON public.ngo_registry (zupanija, naziv COLLATE public.hr_sort, udr_id);
CREATE INDEX idx_ngo_registry_directory_city_name
  ON public.ngo_registry (city, naziv COLLATE public.hr_sort, udr_id);
CREATE INDEX idx_ngo_registry_directory_form_name
  ON public.ngo_registry (oblik_udruzivanja, naziv COLLATE public.hr_sort, udr_id);
CREATE INDEX idx_ngo_registry_directory_registered
  ON public.ngo_registry (datum_upisa DESC, udr_id);

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
  v_previous_batch_id text;
  v_members bigint := 0;
  v_removed bigint := 0;
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

  SELECT count(*) INTO v_members
  FROM public.registry_snapshot_memberships
  WHERE batch_id = p_batch_id;
  IF v_members <> p_expected_source_rows THEN
    RAISE EXCEPTION 'registry membership mismatch: members %, expected %',
      v_members, p_expected_source_rows USING ERRCODE = 'P0001';
  END IF;

  WITH duplicate_oibs AS (
    SELECT r.oib
    FROM public.ngo_registry r
    JOIN public.registry_snapshot_memberships m
      ON m.batch_id = p_batch_id AND m.udr_id = r.udr_id
    WHERE r.oib IS NOT NULL
    GROUP BY r.oib
    HAVING count(*) > 1
  )
  UPDATE public.ngo_registry r
  SET validation_status = 'warning',
      validation_errors = CASE
        WHEN r.validation_errors ? 'duplicate_oib_in_source' THEN r.validation_errors
        ELSE r.validation_errors || '["duplicate_oib_in_source"]'::jsonb
      END
  FROM duplicate_oibs d, public.registry_snapshot_memberships m
  WHERE m.batch_id = p_batch_id AND m.udr_id = r.udr_id AND r.oib = d.oib;

  SELECT count(*) FILTER (WHERE r.validation_status = 'warning')
  INTO v_warnings
  FROM public.ngo_registry r
  JOIN public.registry_snapshot_memberships m
    ON m.batch_id = p_batch_id AND m.udr_id = r.udr_id;

  SELECT current_batch_id INTO v_previous_batch_id
  FROM public.registry_publication_state
  WHERE singleton = true
  FOR UPDATE;

  IF v_previous_batch_id IS NOT NULL THEN
    SELECT count(*) INTO v_removed
    FROM public.registry_snapshot_memberships previous
    WHERE previous.batch_id = v_previous_batch_id
      AND NOT EXISTS (
        SELECT 1 FROM public.registry_snapshot_memberships current
        WHERE current.batch_id = p_batch_id AND current.udr_id = previous.udr_id
      );
  END IF;

  UPDATE public.registry_publication_state
  SET current_batch_id = p_batch_id,
      published_at = now(),
      updated_at = now()
  WHERE singleton = true;

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
    'current_rows', v_members,
    'warning_rows', v_warnings,
    'removed_rows', v_removed,
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
    'total', count(*),
    'statuses', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', amount)
        ORDER BY amount DESC, value COLLATE public.hr_sort), '[]'::jsonb)
      FROM (SELECT status value, count(*) amount FROM public.current_association_registry GROUP BY status) grouped
    ),
    'counties', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', amount)
        ORDER BY value COLLATE public.hr_sort), '[]'::jsonb)
      FROM (SELECT zupanija value, count(*) amount FROM public.current_association_registry WHERE zupanija IS NOT NULL GROUP BY zupanija) grouped
    ),
    'forms', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'count', amount)
        ORDER BY amount DESC, value COLLATE public.hr_sort), '[]'::jsonb)
      FROM (SELECT oblik_udruzivanja value, count(*) amount FROM public.current_association_registry WHERE oblik_udruzivanja IS NOT NULL GROUP BY oblik_udruzivanja) grouped
    ),
    'snapshot', (
      SELECT jsonb_build_object(
        'metadata_modified', b.source_metadata_modified,
        'imported_at', b.completed_at,
        'source_file_hash', b.source_file_hash,
        'source_resource_id', b.source_resource_id
      )
      FROM public.registry_publication_state state
      LEFT JOIN public.registry_import_batches b ON b.id = state.current_batch_id
      WHERE state.singleton = true
    )
  )
  FROM public.current_association_registry;
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
  FROM public.current_association_registry r
  WHERE (v_query IS NULL OR r.search_text ILIKE '%' || lower(v_query) || '%')
    AND (v_status IS NULL OR r.status = v_status)
    AND (v_county IS NULL OR r.zupanija = v_county)
    AND (v_city IS NULL OR r.city ILIKE '%' || v_city || '%')
    AND (v_form IS NULL OR r.oblik_udruzivanja = v_form);

  v_offset := (p_page - 1) * p_page_size;
  EXECUTE pg_catalog.format($query$
    SELECT coalesce(jsonb_agg(item), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id', r.udr_id, 'oib', r.oib, 'name', r.naziv,
        'short_name', r.skraceni_naziv, 'status', r.status,
        'address', r.sjediste, 'city', r.city, 'county', r.zupanija,
        'registered_on', r.datum_upisa, 'status_changed_on', r.datum_statusa,
        'registry_number', r.registarski_broj, 'legal_form', r.oblik_udruzivanja,
        'email', r.mail, 'website', r.web_stranica,
        'last_verified_at', r.last_verified_at
      ) item
      FROM public.current_association_registry r
      WHERE ($1 IS NULL OR r.search_text ILIKE '%%' || lower($1) || '%%')
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
      'total', v_total, 'page', p_page, 'page_size', p_page_size,
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
    'id', r.udr_id, 'oib', r.oib, 'name', r.naziv,
    'short_name', r.skraceni_naziv, 'status', r.status,
    'goals', r.ciljevi, 'address', r.sjediste, 'city', r.city,
    'county', r.zupanija, 'registered_on', r.datum_upisa,
    'website', r.web_stranica, 'email', r.mail,
    'status_changed_on', r.datum_statusa, 'target_groups', r.ciljane_skupine,
    'activity_description', r.opis_djelatnosti,
    'registry_number', r.registarski_broj, 'legal_form', r.oblik_udruzivanja,
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
  FROM public.current_association_registry r
  WHERE r.udr_id = p_udr_id;
$$;

REVOKE ALL ON FUNCTION public.finalize_registry_import_batch(text, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.association_registry_facets_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_association_registry_v1(text, text, text, text, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_association_registry_entry_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_registry_import_batch(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.association_registry_facets_v1() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_association_registry_v1(text, text, text, text, text, text, integer, integer)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_association_registry_entry_v1(text) TO anon, authenticated, service_role;

COMMIT;
