-- Fix: NGO need/event creation failed with
-- "infinite recursion detected in policy for relation profiles".
--
-- Root cause: migration 008 added two RLS policies that form a cycle
-- between profiles and volunteer_signups:
--
--   profiles  "Institution reads signup volunteer profiles"
--     USING ( ... JOIN public.profiles me ...                 -- self-ref
--                JOIN public.volunteer_signups vs ... )
--
--   volunteer_signups "Institution reads signups for own events"
--     USING ( ... JOIN public.profiles p ON p.id = auth.uid() ... )
--
-- Even after removing the self-ref, profiles → volunteer_signups →
-- profiles → volunteer_signups keeps Postgres flagging recursion on
-- profiles.
--
-- Break the cycle by wrapping each RLS check in a SECURITY DEFINER
-- helper so the policy body no longer reads its own table (or the
-- other table in the cycle) under RLS. Pattern matches migration 007.
--
-- Idempotent; safe to re-run.

-- 1. Caller's NGO institution_id (bypasses RLS via SECURITY DEFINER).
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

-- 2. Does the caller's NGO run an event this user is signed up for?
CREATE OR REPLACE FUNCTION public.ngo_sees_volunteer_profile(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.volunteer_signups vs
    JOIN public.volunteer_events ve ON ve.id = vs.event_id
    WHERE vs.user_id = p_user_id
      AND ve.institution_id = public.current_user_institution_id()
      AND public.current_user_institution_id() IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.ngo_sees_volunteer_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ngo_sees_volunteer_profile(uuid) TO authenticated;

-- 3. Does an event belong to the caller's NGO?
CREATE OR REPLACE FUNCTION public.ngo_owns_volunteer_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.volunteer_events ve
    WHERE ve.id = p_event_id
      AND ve.institution_id = public.current_user_institution_id()
      AND public.current_user_institution_id() IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.ngo_owns_volunteer_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ngo_owns_volunteer_event(uuid) TO authenticated;

-- 4. Replace recursive profiles policy with SECURITY DEFINER call.
DROP POLICY IF EXISTS "Institution reads signup volunteer profiles" ON public.profiles;
CREATE POLICY "Institution reads signup volunteer profiles"
  ON public.profiles FOR SELECT
  USING (public.ngo_sees_volunteer_profile(profiles.id));

-- 5. Replace volunteer_signups policies that join profiles so they
--    don't re-trigger profiles RLS (which closes the cycle).
DROP POLICY IF EXISTS "Institution reads signups for own events" ON public.volunteer_signups;
CREATE POLICY "Institution reads signups for own events"
  ON public.volunteer_signups FOR SELECT
  USING (public.ngo_owns_volunteer_event(volunteer_signups.event_id));

DROP POLICY IF EXISTS "Institution updates check-in on own event signups" ON public.volunteer_signups;
CREATE POLICY "Institution updates check-in on own event signups"
  ON public.volunteer_signups FOR UPDATE
  USING (public.ngo_owns_volunteer_event(volunteer_signups.event_id));
