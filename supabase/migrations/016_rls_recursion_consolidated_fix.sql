-- =============================================================
-- 016: consolidated RLS-recursion fix + description nullability
-- =============================================================
-- The live database hit "infinite recursion detected in policy for relation
-- profiles" on NGO need/event creation. Investigation showed migration 012
-- was only partially applied (the current_user_institution_id helper landed
-- but its dependant helpers and policy rewrites did not), and migration 013
-- never ran. This file is a self-contained, idempotent re-apply of those
-- two plus the description-nullability change from 015.
--
-- Safe to run on a healthy DB — every statement is guarded with
-- IF EXISTS / IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.

-- -----------------------------------------------------------------
-- 1. SECURITY DEFINER helpers (from migrations 008 + 012)
-- -----------------------------------------------------------------

-- Caller's NGO institution_id, RLS-bypassing.
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

-- Does the caller's NGO run an event this user is signed up for?
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

-- Does an event belong to the caller's NGO?
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

-- -----------------------------------------------------------------
-- 2. Replace the recursive policy on profiles.
-- -----------------------------------------------------------------
DROP POLICY IF EXISTS "Institution reads signup volunteer profiles" ON public.profiles;
CREATE POLICY "Institution reads signup volunteer profiles"
  ON public.profiles FOR SELECT
  USING (public.ngo_sees_volunteer_profile(profiles.id));

-- -----------------------------------------------------------------
-- 3. Replace the joined volunteer_signups policies that closed the cycle.
-- -----------------------------------------------------------------
DROP POLICY IF EXISTS "Institution reads signups for own events" ON public.volunteer_signups;
CREATE POLICY "Institution reads signups for own events"
  ON public.volunteer_signups FOR SELECT
  USING (public.ngo_owns_volunteer_event(volunteer_signups.event_id));

DROP POLICY IF EXISTS "Institution updates check-in on own event signups" ON public.volunteer_signups;
CREATE POLICY "Institution updates check-in on own event signups"
  ON public.volunteer_signups FOR UPDATE
  USING (public.ngo_owns_volunteer_event(volunteer_signups.event_id));

-- -----------------------------------------------------------------
-- 4. Description nullability (migration 015 — folded in here so a single
--    paste fixes both reported issues).
-- -----------------------------------------------------------------
ALTER TABLE public.needs            ALTER COLUMN description DROP NOT NULL;
ALTER TABLE public.volunteer_events ALTER COLUMN description DROP NOT NULL;
