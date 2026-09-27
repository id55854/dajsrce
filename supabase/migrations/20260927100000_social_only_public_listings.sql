-- Public listings show associations of a social character only.
--
-- The platform is only for social-care associations: the map, the register
-- directory and the donation wizard ask for the twelve social categories
-- only (application change of 2026-09-27). Two public reads still reached
-- the rest:
-- 1. engaged_association_directory_v1 listed every organisation with an
--    account, including ones whose register row is the unclassified
--    `association` catch-all. It now lists social ones only.
-- 2. get_association_registry_entry_v1 carried no category, so
--    /organisations/<id> rendered any register entry by direct link. It now
--    returns the directory's category, and the page and its API decline an
--    entry that is not social. The claim flow still reads names through it.
-- Bodies are the live ones from 2026-09-27 with only those lines added.

CREATE OR REPLACE FUNCTION public.get_association_registry_entry_v1(p_udr_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    -- The reviewed classification, so public pages can decline the entries
    -- that are not of a social character (20260927100000).
    'category', directory.category,
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
$function$;

CREATE OR REPLACE FUNCTION public.engaged_association_directory_v1(p_query text DEFAULT NULL::text, p_county text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_only_with_needs boolean DEFAULT false, p_only_verified boolean DEFAULT false, p_page integer DEFAULT 1, p_page_size integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := greatest(1, least(coalesce(p_page_size, 24), 100));
  v_query text;
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF length(coalesce(p_query, '')) > 100 THEN
    RAISE EXCEPTION 'search query input is too long';
  END IF;
  IF length(coalesce(p_county, '')) > 100 OR length(coalesce(p_city, '')) > 150 THEN
    RAISE EXCEPTION 'location filter input is too long';
  END IF;
  IF p_page > 10000 THEN
    RAISE EXCEPTION 'page is out of range';
  END IF;

  v_query := nullif(
    btrim(regexp_replace(replace(replace(lower(coalesce(p_query, '')), '%', ' '), '_', ' '), '[[:space:]]+', ' ', 'g')),
    ''
  );

  WITH engaged AS (
    SELECT
      d.udr_id,
      d.oib,
      d.name,
      d.short_name,
      d.status,
      d.address,
      d.city,
      d.county,
      d.registered_on,
      d.status_changed_on,
      d.registry_number,
      d.legal_form,
      d.email,
      d.website,
      d.last_verified_at,
      i.id AS institution_id,
      coalesce(i.is_verified, false) AS is_verified,
      coalesce(i.accepts_donations, ARRAY[]::text[]) AS accepts_donations,
      (
        SELECT count(*)
        FROM public.needs n
        WHERE n.institution_id = i.id AND n.is_fulfilled = false
      ) AS open_needs,
      (
        SELECT count(*)
        FROM public.needs n
        WHERE n.institution_id = i.id
          AND n.is_fulfilled = false
          AND n.urgency = 'urgent'
      ) AS urgent_needs
    FROM public.registry_publication_state state
    JOIN public.registry_directory_entries d ON d.batch_id = state.current_batch_id
    JOIN public.institutions i ON i.id = d.institution_id
    WHERE state.singleton = true
      AND (v_query IS NULL OR d.search_text ILIKE '%' || v_query || '%')
      AND (p_county IS NULL OR d.county = p_county)
      AND (p_city IS NULL OR d.city = p_city)
      AND (NOT coalesce(p_only_verified, false) OR coalesce(i.is_verified, false))
      -- Engaged means a real account, not merely a linked institution row --
      -- see the header note and 20260821130000 for the map's identical fix.
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.institution_id = i.id AND p.role = 'ngo'
      )
      -- DajSrce is only for associations of a social character; an account on
      -- an unclassified (`association`) row is not listed (20260927100000).
      AND coalesce(nullif(btrim(coalesce(i.category, '')), ''), d.category, 'association') <> 'association'
  ), narrowed AS (
    SELECT * FROM engaged
    WHERE NOT coalesce(p_only_with_needs, false) OR open_needs > 0
  ), counted AS (
    SELECT count(*)::bigint AS total FROM narrowed
  ), page AS (
    SELECT *
    FROM narrowed
    -- Organisations with something open come first: this listing exists to
    -- answer "who can I help now", and alphabetical order buries them.
    ORDER BY urgent_needs DESC, open_needs DESC, name COLLATE public.hr_sort, udr_id
    LIMIT v_page_size
    OFFSET (v_page - 1) * v_page_size
  )
  SELECT
    counted.total,
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', page.udr_id,
            'oib', page.oib,
            'name', page.name,
            'short_name', page.short_name,
            'status', page.status,
            'address', page.address,
            'city', page.city,
            'county', page.county,
            'registered_on', page.registered_on,
            'status_changed_on', page.status_changed_on,
            'registry_number', page.registry_number,
            'legal_form', page.legal_form,
            'email', page.email,
            'website', page.website,
            'last_verified_at', page.last_verified_at,
            'institution_id', page.institution_id,
            'is_verified', page.is_verified,
            'accepts_donations', to_jsonb(page.accepts_donations),
            'open_needs', page.open_needs,
            'urgent_needs', page.urgent_needs
          )
          -- `jsonb_agg` does not inherit the CTE's ordering, so the page's
          -- order has to be restated here or the rows arrive shuffled.
          ORDER BY page.urgent_needs DESC, page.open_needs DESC,
                   page.name COLLATE public.hr_sort, page.udr_id
        )
        FROM page
      ),
      '[]'::jsonb
    )
  INTO v_total, v_items
  FROM counted;

  RETURN jsonb_build_object(
    'version', 1,
    'items', v_items,
    'meta', jsonb_build_object(
      'total', v_total,
      'page', v_page,
      'page_size', v_page_size,
      'page_count', CASE WHEN v_total = 0 THEN 0 ELSE ((v_total + v_page_size - 1) / v_page_size)::integer END
    )
  );
END;
$function$;
