-- Make the register listing match what the map already shows by default.
--
-- The map defaults `onlySocial` to true and has no remaining UI to turn it
-- off (that toggle was deliberately removed), so a visitor only ever sees
-- the ~3,000 rows the classifier placed in one of the twelve real categories
-- out of the 43,703-row official register. `/organisations` never applied
-- that filter at all, so it showed the whole register -- a visitor comparing
-- the two surfaces saw wildly different counts for what looked like the same
-- listing.
--
-- `search_association_registry_v1` gains `p_classified_only`, defaulting to
-- false so the two other callers that intentionally want the whole register
-- are untouched without any code change on their side:
--   - `scripts/verify-official-registry.mjs` verifies production holds
--     exactly the 43,703 active CTS rows; narrowing its query would make it
--     verify the wrong thing.
--   - the institution-claim picker uses its own `search_claimable_associations_v1`
--     (see 20260812120000_institution_claims.sql), not this function at all.
-- Only `associationDirectoryRpcArgs` (the `/organisations` page's own query
-- builder) is changed to always pass `p_classified_only: true`.
--
-- `category` defaults to `'association'` on rows the classifier never placed
-- (see the column added in 20260805160000_active_registry_map.sql) -- the
-- exact same catch-all the map's `SOCIAL_MAP_CATEGORIES` filters out.
--
-- The function gains an argument, so it is dropped and recreated rather than
-- replaced: CREATE OR REPLACE with a new signature leaves the old 8-argument
-- overload in place, which a rolling deploy could still resolve to and would
-- silently ignore the new filter.

BEGIN;

DROP FUNCTION IF EXISTS public.search_association_registry_v1(text, text, text, text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.search_association_registry_v1(p_query text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_county text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_form text DEFAULT NULL::text, p_sort text DEFAULT 'name_asc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 24, p_classified_only boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_batch_id text;
  v_query text := nullif(btrim(p_query), '');
  v_status text := nullif(btrim(p_status), '');
  v_county text := nullif(btrim(p_county), '');
  v_city text := nullif(btrim(p_city), '');
  v_form text := nullif(btrim(p_form), '');
  v_order text;
  v_terms text[];
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

  -- Same all-terms rule as the map; see map_association_registry_v1.
  v_terms := (
    SELECT array_agg(term)
    FROM (
      SELECT term
      FROM unnest(string_to_array(lower(coalesce(v_query, '')), ' ')) AS term
      WHERE length(term) >= 2
      LIMIT 6
    ) capped
  );
  IF coalesce(cardinality(v_terms), 0) = 0 AND v_query IS NOT NULL THEN
    v_terms := ARRAY[lower(v_query)];
  END IF;

  -- The immutable facets total is the whole register, so the fast path only
  -- applies when nothing -- including the classified-only filter -- narrows it.
  IF v_query IS NULL AND v_status IS NULL AND v_county IS NULL AND v_city IS NULL AND v_form IS NULL AND NOT p_classified_only THEN
    SELECT total INTO v_total
    FROM public.registry_snapshot_facets
    WHERE batch_id = v_batch_id;
  ELSE
    SELECT count(*) INTO v_total FROM public.registry_directory_entries d
    WHERE d.batch_id = v_batch_id
      AND (
        v_terms IS NULL
        OR (
          d.search_text ILIKE '%' || v_terms[1] || '%'
          AND NOT EXISTS (
            SELECT 1 FROM unnest(v_terms[2:]) AS term
            WHERE d.search_text NOT ILIKE '%' || term || '%'
          )
        )
      )
      AND (v_status IS NULL OR d.status = v_status)
      AND (v_county IS NULL OR d.county = v_county)
      AND (v_city IS NULL OR d.city ILIKE '%' || v_city || '%')
      AND (v_form IS NULL OR d.legal_form = v_form)
      AND (NOT p_classified_only OR d.category <> 'association');
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
        AND (
          $2 IS NULL
          OR (
            d.search_text ILIKE '%%' || $2[1] || '%%'
            AND NOT EXISTS (
              SELECT 1 FROM unnest($2[2:]) AS term
              WHERE d.search_text NOT ILIKE '%%' || term || '%%'
            )
          )
        )
        AND ($3 IS NULL OR d.status = $3)
        AND ($4 IS NULL OR d.county = $4)
        AND ($5 IS NULL OR d.city ILIKE '%%' || $5 || '%%')
        AND ($6 IS NULL OR d.legal_form = $6)
        AND (NOT $9 OR d.category <> 'association')
      ORDER BY %s LIMIT $7 OFFSET $8
    ) page_rows
  $query$, v_order)
  INTO v_items
  USING v_batch_id, v_terms, v_status, v_county, v_city, v_form, p_page_size, (p_page - 1) * p_page_size, p_classified_only;

  RETURN jsonb_build_object('version', 1, 'items', v_items, 'meta', jsonb_build_object(
    'total', v_total, 'page', p_page, 'page_size', p_page_size,
    'page_count', CASE WHEN v_total = 0 THEN 0 ELSE ceil(v_total::numeric / p_page_size)::integer END));
END;
$function$;

REVOKE ALL ON FUNCTION public.search_association_registry_v1(text, text, text, text, text, text, integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_association_registry_v1(text, text, text, text, text, text, integer, integer, boolean) TO anon, authenticated, service_role;

COMMIT;
