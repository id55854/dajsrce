-- Fix: the "Institution reads signup volunteer profiles" policy added in
-- migration 008 joined public.profiles back to itself inside its USING
-- expression, causing "infinite recursion detected in policy for relation
-- profiles" whenever ANY query against profiles ran (including the NGO
-- guard in /api/needs POST and /api/volunteer-events POST).
--
-- Replace the self-referential join with a SECURITY DEFINER helper that
-- reads the caller's institution_id bypassing RLS, matching the pattern
-- used for company_members in migration 007. Idempotent.

CREATE OR REPLACE FUNCTION public.current_user_institution_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT institution_id
  FROM public.profiles
  WHERE id = auth.uid()
    AND role = 'ngo';
$$;

REVOKE ALL ON FUNCTION public.current_user_institution_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_institution_id() TO authenticated;

DROP POLICY IF EXISTS "Institution reads signup volunteer profiles" ON public.profiles;
CREATE POLICY "Institution reads signup volunteer profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.volunteer_signups vs
      JOIN public.volunteer_events ve ON ve.id = vs.event_id
      WHERE vs.user_id = profiles.id
        AND ve.institution_id = public.current_user_institution_id()
        AND public.current_user_institution_id() IS NOT NULL
    )
  );
