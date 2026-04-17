-- Phase 3: CSR report files + safe public profile RPC.
-- Tightens companies SELECT so anonymous users no longer read full rows
-- (OIB, revenue, etc.) solely because public_profile_enabled is true.

-- ---------------------------------------------------------------------------
-- 1. company_csr_reports: generated PDF + DOCX in private storage.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_csr_reports (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  pdf_storage_path text,
  docx_storage_path text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  manifest_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_company_csr_reports_company
  ON public.company_csr_reports(company_id, generated_at DESC);

ALTER TABLE public.company_csr_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "CSR reports read finance" ON public.company_csr_reports;
CREATE POLICY "CSR reports read finance"
  ON public.company_csr_reports FOR SELECT
  USING (public.current_user_company_finance_access(company_id));

-- ---------------------------------------------------------------------------
-- 2. Storage bucket for CSR artefacts (private; signed URLs from API).
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('reports', 'reports', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Companies: members-only SELECT (remove public full-row leak).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Members read their company" ON public.companies;
CREATE POLICY "Members read their company"
  ON public.companies FOR SELECT
  USING (
    owner_id = auth.uid()
    OR public.current_user_company_member(id)
  );

-- ---------------------------------------------------------------------------
-- 4. Public profile bundle (safe fields + aggregates only).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_public_company_bundle(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  c RECORD;
  v_metrics jsonb;
  v_campaigns jsonb;
  v_report jsonb;
  v_stories jsonb;
BEGIN
  SELECT
    id,
    slug,
    display_name,
    legal_name,
    tagline,
    logo_url,
    brand_primary_hex,
    brand_secondary_hex,
    social,
    subscription_tier,
    public_profile_enabled
  INTO c
  FROM public.companies
  WHERE slug = p_slug;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT (
    c.public_profile_enabled = true
    AND c.subscription_tier IN ('sme_plus', 'enterprise')
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'total_given_eur', COALESCE((
      SELECT SUM(p.amount_eur)
      FROM public.pledges p
      WHERE p.company_id = c.id
        AND p.status IN ('delivered', 'confirmed')
        AND p.amount_eur IS NOT NULL
    ), 0),
    'volunteer_hours', COALESCE((
      SELECT SUM(vh.hours)
      FROM public.volunteer_hours vh
      WHERE vh.company_id = c.id
    ), 0),
    'institutions_supported', COALESCE((
      SELECT COUNT(DISTINCT n.institution_id)
      FROM public.pledges p
      JOIN public.needs n ON n.id = p.need_id
      WHERE p.company_id = c.id
        AND p.status IN ('delivered', 'confirmed')
    ), 0)::bigint
  )
  INTO v_metrics;

  v_campaigns := COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', q.name,
          'slug', q.slug,
          'sdg_tags', q.sdg_tags
        )
        ORDER BY q.created_at DESC
      )
      FROM (
        SELECT name, slug, sdg_tags, created_at
        FROM public.campaigns
        WHERE company_id = c.id
          AND is_active = true
        ORDER BY created_at DESC
        LIMIT 12
      ) q
    ),
    '[]'::jsonb
  );

  v_report := (
    SELECT to_jsonb(r)
    FROM (
      SELECT id, period_start, period_end, generated_at
      FROM public.company_csr_reports
      WHERE company_id = c.id
      ORDER BY generated_at DESC
      LIMIT 1
    ) r
  );

  v_stories := COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'institution_name', i.name,
          'description', LEFT(COALESCE(i.description, ''), 400)
        )
      )
      FROM (
        SELECT n.institution_id, SUM(p.amount_eur) AS total_eur
        FROM public.pledges p
        JOIN public.needs n ON n.id = p.need_id
        WHERE p.company_id = c.id
          AND p.status IN ('delivered', 'confirmed')
          AND p.amount_eur IS NOT NULL
        GROUP BY n.institution_id
        ORDER BY total_eur DESC
        LIMIT 2
      ) tops
      JOIN public.institutions i ON i.id = tops.institution_id
    ),
    '[]'::jsonb
  );

  RETURN jsonb_build_object(
    'company', jsonb_build_object(
      'id', c.id,
      'slug', c.slug,
      'display_name', c.display_name,
      'legal_name', c.legal_name,
      'tagline', c.tagline,
      'logo_url', c.logo_url,
      'brand_primary_hex', c.brand_primary_hex,
      'brand_secondary_hex', c.brand_secondary_hex,
      'social', c.social
    ),
    'metrics', v_metrics,
    'campaigns', v_campaigns,
    'latest_report', v_report,
    'stories', COALESCE(v_stories, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_company_bundle(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_company_bundle(text) TO anon, authenticated;
