-- Registry classification moves to TypeSafe's Jev (scripts/classify-registry-jev.mjs).
--
-- 1. apply_registry_classifications also refreshes the category of the
--    current snapshot's directory rows for the organisations it updates, in
--    the same transaction, so a reclassification reaches the map without
--    waiting for the next registry sync. Curated institutions still win, and
--    only auto_eligible classifications are ever shown.
-- 2. merge_registry_import_batch keeps a Jev classification when the
--    organisation's name, goals, activities and target groups are unchanged.
--    Without this every sync would overwrite Jev's answer with the old rule
--    output. New or changed rows arrive unmapped (pending:jev) from the
--    importer and are classified by the registry:classify step that follows
--    every sync.

CREATE OR REPLACE FUNCTION public.apply_registry_classifications(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_changed integer;
  v_batch_id text;
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

  SELECT current_batch_id INTO v_batch_id
  FROM public.registry_publication_state
  WHERE singleton = true;

  IF v_batch_id IS NOT NULL THEN
    UPDATE public.registry_directory_entries d
    SET category = CASE
      WHEN i.id IS NOT NULL THEN i.category
      WHEN r.classification_status = 'auto_eligible' AND r.mapped_category IS NOT NULL THEN r.mapped_category
      ELSE 'association'
    END
    FROM public.ngo_registry r
    LEFT JOIN public.institutions i ON i.id = r.institution_id
    WHERE d.batch_id = v_batch_id
      AND d.udr_id = r.udr_id
      AND r.udr_id IN (
        SELECT x.udr_id FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS x(udr_id text)
      )
      AND d.category IS DISTINCT FROM CASE
        WHEN i.id IS NOT NULL THEN i.category
        WHEN r.classification_status = 'auto_eligible' AND r.mapped_category IS NOT NULL THEN r.mapped_category
        ELSE 'association'
      END;
  END IF;

  RETURN v_changed;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_registry_classifications(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_registry_classifications(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.merge_registry_import_batch(p_batch_id text, p_from_row bigint, p_to_row bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    mapped_category = CASE WHEN (public.ngo_registry.classification_version LIKE 'jev-%'
      AND public.ngo_registry.naziv IS NOT DISTINCT FROM EXCLUDED.naziv
      AND public.ngo_registry.ciljevi IS NOT DISTINCT FROM EXCLUDED.ciljevi
      AND public.ngo_registry.opis_djelatnosti IS NOT DISTINCT FROM EXCLUDED.opis_djelatnosti
      AND public.ngo_registry.ciljane_skupine IS NOT DISTINCT FROM EXCLUDED.ciljane_skupine)
      THEN public.ngo_registry.mapped_category ELSE EXCLUDED.mapped_category END,
    mapped_confidence = CASE WHEN (public.ngo_registry.classification_version LIKE 'jev-%'
      AND public.ngo_registry.naziv IS NOT DISTINCT FROM EXCLUDED.naziv
      AND public.ngo_registry.ciljevi IS NOT DISTINCT FROM EXCLUDED.ciljevi
      AND public.ngo_registry.opis_djelatnosti IS NOT DISTINCT FROM EXCLUDED.opis_djelatnosti
      AND public.ngo_registry.ciljane_skupine IS NOT DISTINCT FROM EXCLUDED.ciljane_skupine)
      THEN public.ngo_registry.mapped_confidence ELSE EXCLUDED.mapped_confidence END,
    mapped_rule = CASE WHEN (public.ngo_registry.classification_version LIKE 'jev-%'
      AND public.ngo_registry.naziv IS NOT DISTINCT FROM EXCLUDED.naziv
      AND public.ngo_registry.ciljevi IS NOT DISTINCT FROM EXCLUDED.ciljevi
      AND public.ngo_registry.opis_djelatnosti IS NOT DISTINCT FROM EXCLUDED.opis_djelatnosti
      AND public.ngo_registry.ciljane_skupine IS NOT DISTINCT FROM EXCLUDED.ciljane_skupine)
      THEN public.ngo_registry.mapped_rule ELSE EXCLUDED.mapped_rule END,
    import_batch_id = EXCLUDED.import_batch_id,
    raw_row_jsonb = NULL,
    source_row_number = EXCLUDED.source_row_number,
    source_file_hash = EXCLUDED.source_file_hash,
    validation_status = EXCLUDED.validation_status,
    validation_errors = EXCLUDED.validation_errors,
    classification_status = CASE WHEN (public.ngo_registry.classification_version LIKE 'jev-%'
      AND public.ngo_registry.naziv IS NOT DISTINCT FROM EXCLUDED.naziv
      AND public.ngo_registry.ciljevi IS NOT DISTINCT FROM EXCLUDED.ciljevi
      AND public.ngo_registry.opis_djelatnosti IS NOT DISTINCT FROM EXCLUDED.opis_djelatnosti
      AND public.ngo_registry.ciljane_skupine IS NOT DISTINCT FROM EXCLUDED.ciljane_skupine)
      THEN public.ngo_registry.classification_status ELSE EXCLUDED.classification_status END,
    classification_reasons = CASE WHEN (public.ngo_registry.classification_version LIKE 'jev-%'
      AND public.ngo_registry.naziv IS NOT DISTINCT FROM EXCLUDED.naziv
      AND public.ngo_registry.ciljevi IS NOT DISTINCT FROM EXCLUDED.ciljevi
      AND public.ngo_registry.opis_djelatnosti IS NOT DISTINCT FROM EXCLUDED.opis_djelatnosti
      AND public.ngo_registry.ciljane_skupine IS NOT DISTINCT FROM EXCLUDED.ciljane_skupine)
      THEN public.ngo_registry.classification_reasons ELSE EXCLUDED.classification_reasons END,
    classification_candidates = CASE WHEN (public.ngo_registry.classification_version LIKE 'jev-%'
      AND public.ngo_registry.naziv IS NOT DISTINCT FROM EXCLUDED.naziv
      AND public.ngo_registry.ciljevi IS NOT DISTINCT FROM EXCLUDED.ciljevi
      AND public.ngo_registry.opis_djelatnosti IS NOT DISTINCT FROM EXCLUDED.opis_djelatnosti
      AND public.ngo_registry.ciljane_skupine IS NOT DISTINCT FROM EXCLUDED.ciljane_skupine)
      THEN public.ngo_registry.classification_candidates ELSE EXCLUDED.classification_candidates END,
    classification_version = CASE WHEN (public.ngo_registry.classification_version LIKE 'jev-%'
      AND public.ngo_registry.naziv IS NOT DISTINCT FROM EXCLUDED.naziv
      AND public.ngo_registry.ciljevi IS NOT DISTINCT FROM EXCLUDED.ciljevi
      AND public.ngo_registry.opis_djelatnosti IS NOT DISTINCT FROM EXCLUDED.opis_djelatnosti
      AND public.ngo_registry.ciljane_skupine IS NOT DISTINCT FROM EXCLUDED.ciljane_skupine)
      THEN public.ngo_registry.classification_version ELSE EXCLUDED.classification_version END,
    donation_candidates = CASE WHEN (public.ngo_registry.classification_version LIKE 'jev-%'
      AND public.ngo_registry.naziv IS NOT DISTINCT FROM EXCLUDED.naziv
      AND public.ngo_registry.ciljevi IS NOT DISTINCT FROM EXCLUDED.ciljevi
      AND public.ngo_registry.opis_djelatnosti IS NOT DISTINCT FROM EXCLUDED.opis_djelatnosti
      AND public.ngo_registry.ciljane_skupine IS NOT DISTINCT FROM EXCLUDED.ciljane_skupine)
      THEN public.ngo_registry.donation_candidates ELSE EXCLUDED.donation_candidates END,
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
$function$;

REVOKE ALL ON FUNCTION public.merge_registry_import_batch(text, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_registry_import_batch(text, bigint, bigint) TO service_role;
