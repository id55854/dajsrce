-- Rule-promoted institutions no longer override Jev.
--
-- The old promoter (registry:promote) created 2,525 institutions with
-- source = 'registry' from keyword-rule categories. None has an account and
-- none was reviewed, but the directory projection treats every linked
-- institution as curated (the projection prefers `i.category`), so 1,735 of them kept
-- showing the rule category over Jev's. Only a person's choice should win:
-- source 'curated' rows and institutions an NGO claimed keep their category;
-- rule-promoted rows without an account now follow the classification.
--
-- The previous categories are kept in ops.institutions_category_before_jev
-- (schema not exposed by the Data API) for audit and rollback.

CREATE SCHEMA IF NOT EXISTS ops;
REVOKE ALL ON SCHEMA ops FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS ops.institutions_category_before_jev AS
SELECT id, category, source, now() AS saved_at
FROM public.institutions
WHERE source = 'registry';
REVOKE ALL ON ops.institutions_category_before_jev FROM PUBLIC, anon, authenticated;

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

  -- Institutions the old rule promoter created (source = 'registry', no
  -- account, never reviewed) follow the classification. Curated rows and
  -- claimed organisations keep the category a person chose.
  UPDATE public.institutions i
  SET category = coalesce(
    CASE WHEN r.classification_status = 'auto_eligible' THEN r.mapped_category END,
    'association'
  )
  FROM public.ngo_registry r
  WHERE r.institution_id = i.id
    AND i.source = 'registry'
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.institution_id = i.id)
    AND r.udr_id IN (
      SELECT x.udr_id FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS x(udr_id text)
    )
    AND i.category IS DISTINCT FROM coalesce(
      CASE WHEN r.classification_status = 'auto_eligible' THEN r.mapped_category END,
      'association'
    );

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

-- One-off: bring every existing rule-promoted institution and the current
-- snapshot's directory rows in line with the classification.
UPDATE public.institutions i
SET category = coalesce(
  CASE WHEN r.classification_status = 'auto_eligible' THEN r.mapped_category END,
  'association'
)
FROM public.ngo_registry r
WHERE r.institution_id = i.id
  AND i.source = 'registry'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.institution_id = i.id)
  AND i.category IS DISTINCT FROM coalesce(
    CASE WHEN r.classification_status = 'auto_eligible' THEN r.mapped_category END,
    'association'
  );

UPDATE public.registry_directory_entries d
SET category = coalesce(
  i.category,
  CASE WHEN r.classification_status = 'auto_eligible' THEN r.mapped_category END,
  'association'
)
FROM public.ngo_registry r
LEFT JOIN public.institutions i ON i.id = r.institution_id
WHERE d.udr_id = r.udr_id
  AND d.batch_id = (SELECT current_batch_id FROM public.registry_publication_state WHERE singleton = true)
  AND d.category IS DISTINCT FROM coalesce(
    i.category,
    CASE WHEN r.classification_status = 'auto_eligible' THEN r.mapped_category END,
    'association'
  );
