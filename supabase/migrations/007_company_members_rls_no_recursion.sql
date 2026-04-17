-- Fix: policies on company_members that subquery company_members caused
-- "infinite recursion detected in policy for relation company_members".
-- Run this if you already applied an older 004 without section 11b helpers.
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.current_user_company_member(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.company_id = p_company_id AND m.profile_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_company_staff(p_company_id uuid)
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
      AND m.role IN ('owner', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_company_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_company_member(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.current_user_company_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_company_staff(uuid) TO authenticated;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read their company" ON public.companies;
CREATE POLICY "Members read their company"
  ON public.companies FOR SELECT
  USING (
    owner_id = auth.uid()
    OR public.current_user_company_member(id)
    OR public_profile_enabled = true
  );

DROP POLICY IF EXISTS "Authenticated users can create companies" ON public.companies;
CREATE POLICY "Authenticated users can create companies"
  ON public.companies FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Owner or admin updates company" ON public.companies;
CREATE POLICY "Owner or admin updates company"
  ON public.companies FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR public.current_user_company_staff(id)
  );

DROP POLICY IF EXISTS "Members see each other" ON public.company_members;
CREATE POLICY "Members see each other"
  ON public.company_members FOR SELECT
  USING (
    profile_id = auth.uid()
    OR public.current_user_company_member(company_id)
  );

DROP POLICY IF EXISTS "Owner creates initial member" ON public.company_members;
CREATE POLICY "Owner creates initial member"
  ON public.company_members FOR INSERT
  WITH CHECK (
    profile_id = auth.uid()
    OR public.current_user_company_staff(company_id)
  );

DROP POLICY IF EXISTS "Owner or admin removes members" ON public.company_members;
CREATE POLICY "Owner or admin removes members"
  ON public.company_members FOR DELETE
  USING (
    public.current_user_company_staff(company_id)
    AND profile_id <> auth.uid()
  );

DROP POLICY IF EXISTS "Company staff manages domains" ON public.company_domains;
CREATE POLICY "Company staff manages domains"
  ON public.company_domains FOR SELECT
  USING (public.current_user_company_staff(company_id));

DROP POLICY IF EXISTS "Company staff inserts domains" ON public.company_domains;
CREATE POLICY "Company staff inserts domains"
  ON public.company_domains FOR INSERT
  WITH CHECK (public.current_user_company_staff(company_id));

DROP POLICY IF EXISTS "Company staff updates domains" ON public.company_domains;
CREATE POLICY "Company staff updates domains"
  ON public.company_domains FOR UPDATE
  USING (public.current_user_company_staff(company_id));

DROP POLICY IF EXISTS "Company staff reads invites" ON public.company_invites;
CREATE POLICY "Company staff reads invites"
  ON public.company_invites FOR SELECT
  USING (public.current_user_company_staff(company_id));

DROP POLICY IF EXISTS "Company staff creates invites" ON public.company_invites;
CREATE POLICY "Company staff creates invites"
  ON public.company_invites FOR INSERT
  WITH CHECK (public.current_user_company_staff(company_id));

DROP POLICY IF EXISTS "Public reads active campaigns" ON public.campaigns;
CREATE POLICY "Public reads active campaigns"
  ON public.campaigns FOR SELECT
  USING (
    is_active = true
    OR public.current_user_company_member(company_id)
  );

DROP POLICY IF EXISTS "Company staff manages campaigns" ON public.campaigns;
CREATE POLICY "Company staff manages campaigns"
  ON public.campaigns FOR INSERT
  WITH CHECK (public.current_user_company_staff(company_id));

DROP POLICY IF EXISTS "Company staff updates campaigns" ON public.campaigns;
CREATE POLICY "Company staff updates campaigns"
  ON public.campaigns FOR UPDATE
  USING (public.current_user_company_staff(company_id));

DROP POLICY IF EXISTS "Company members view company pledges" ON public.pledges;
CREATE POLICY "Company members view company pledges"
  ON public.pledges FOR SELECT
  USING (
    company_id IS NOT NULL
    AND public.current_user_company_member(company_id)
  );
