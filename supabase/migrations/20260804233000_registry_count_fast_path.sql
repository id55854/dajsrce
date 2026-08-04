-- Unfiltered page totals are immutable snapshot metadata. Avoid rescanning all
-- directory rows on every page, especially for cold deep-page requests.

BEGIN;

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

  IF v_query IS NULL AND v_status IS NULL AND v_county IS NULL AND v_city IS NULL AND v_form IS NULL THEN
    SELECT total INTO v_total
    FROM public.registry_snapshot_facets
    WHERE batch_id = v_batch_id;
  ELSE
    SELECT count(*) INTO v_total FROM public.registry_directory_entries d
    WHERE d.batch_id = v_batch_id
      AND (v_query IS NULL OR d.search_text ILIKE '%' || lower(v_query) || '%')
      AND (v_status IS NULL OR d.status = v_status)
      AND (v_county IS NULL OR d.county = v_county)
      AND (v_city IS NULL OR d.city ILIKE '%' || v_city || '%')
      AND (v_form IS NULL OR d.legal_form = v_form);
  END IF;

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

REVOKE ALL ON FUNCTION public.search_association_registry_v1(text, text, text, text, text, text, integer, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_association_registry_v1(text, text, text, text, text, text, integer, integer)
  TO anon, authenticated, service_role;

COMMIT;
