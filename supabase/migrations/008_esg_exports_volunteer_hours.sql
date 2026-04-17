-- Phase 2: ESG export artefacts + volunteer hour rollups.
-- Additive; safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Finance-tier access (owner / admin / finance) for exports + receipts.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_company_finance_access(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.company_id = p_company_id
      AND m.profile_id = auth.uid()
      AND m.role IN ('owner', 'admin', 'finance')
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_company_finance_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_company_finance_access(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. esg_exports: generated ZIP bundles per framework + period.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.esg_exports (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  framework text NOT NULL
    CHECK (framework IN ('vsme_basic', 'vsme_comp', 'esrs_s1', 'esrs_s3', 'gri_413', 'b4si')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  file_url text,
  manifest_jsonb jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  UNIQUE (company_id, framework, period_start, period_end, version)
);

CREATE INDEX IF NOT EXISTS idx_esg_exports_company ON public.esg_exports(company_id, generated_at DESC);

ALTER TABLE public.esg_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ESG exports read finance" ON public.esg_exports;
CREATE POLICY "ESG exports read finance"
  ON public.esg_exports FOR SELECT
  USING (public.current_user_company_finance_access(company_id));

-- Rows inserted via service role (API); no client INSERT policy.

-- ---------------------------------------------------------------------------
-- 3. volunteer_hours: denormalised hours per checkout session.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.volunteer_hours (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  volunteer_signup_id uuid NOT NULL REFERENCES public.volunteer_signups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  hours numeric(12, 2) NOT NULL CHECK (hours >= 0),
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_volunteer_hours_company_recorded
  ON public.volunteer_hours(company_id, recorded_at)
  WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_volunteer_hours_institution
  ON public.volunteer_hours(institution_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_volunteer_hours_user
  ON public.volunteer_hours(user_id, recorded_at);

ALTER TABLE public.volunteer_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Volunteer hours read own" ON public.volunteer_hours;
CREATE POLICY "Volunteer hours read own"
  ON public.volunteer_hours FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Volunteer hours read institution" ON public.volunteer_hours;
CREATE POLICY "Volunteer hours read institution"
  ON public.volunteer_hours FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'ngo'
        AND p.institution_id = volunteer_hours.institution_id
    )
  );

DROP POLICY IF EXISTS "Volunteer hours read company member" ON public.volunteer_hours;
CREATE POLICY "Volunteer hours read company member"
  ON public.volunteer_hours FOR SELECT
  USING (
    company_id IS NOT NULL
    AND public.current_user_company_member(company_id)
  );

-- Inserts via service role from API after permission checks.

-- ---------------------------------------------------------------------------
-- 4. Storage bucket for export ZIPs (private).
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('exports', 'exports', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. volunteer_signups: NGO can list/update check-in for their events.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Institution reads signups for own events" ON public.volunteer_signups;
CREATE POLICY "Institution reads signups for own events"
  ON public.volunteer_signups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.volunteer_events ve
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE ve.id = volunteer_signups.event_id
        AND ve.institution_id = p.institution_id
        AND p.role = 'ngo'
    )
  );

DROP POLICY IF EXISTS "Institution updates check-in on own event signups" ON public.volunteer_signups;
CREATE POLICY "Institution updates check-in on own event signups"
  ON public.volunteer_signups FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.volunteer_events ve
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE ve.id = volunteer_signups.event_id
        AND ve.institution_id = p.institution_id
        AND p.role = 'ngo'
    )
  );

-- Names for roster: NGO may read profiles of users signed up to their events.
DROP POLICY IF EXISTS "Institution reads signup volunteer profiles" ON public.profiles;
CREATE POLICY "Institution reads signup volunteer profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.volunteer_signups vs
      JOIN public.volunteer_events ve ON ve.id = vs.event_id
      JOIN public.profiles me ON me.id = auth.uid()
      WHERE vs.user_id = profiles.id
        AND ve.institution_id = me.institution_id
        AND me.role = 'ngo'
    )
  );
