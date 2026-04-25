-- Fix: the "Institution reads signups for own events" and "Institution
-- updates check-in on own event signups" policies (migration 008) JOIN
-- public.profiles inside their USING clause. When RLS on profiles (the
-- "Institution reads signup volunteer profiles" policy rewritten in
-- migration 012) evaluates its EXISTS over volunteer_signups, Postgres
-- applies RLS on volunteer_signups — which re-queries profiles,
-- triggering the profiles policy again and producing:
-- "infinite recursion detected in policy for relation profiles".
--
-- Fix by replacing the profiles self-join with the SECURITY DEFINER
-- helper current_user_institution_id() (added in migration 012), which
-- bypasses RLS because its owner (postgres) has BYPASSRLS. Idempotent.

DROP POLICY IF EXISTS "Institution reads signups for own events" ON public.volunteer_signups;
CREATE POLICY "Institution reads signups for own events"
  ON public.volunteer_signups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.volunteer_events ve
      WHERE ve.id = volunteer_signups.event_id
        AND ve.institution_id = public.current_user_institution_id()
        AND public.current_user_institution_id() IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Institution updates check-in on own event signups" ON public.volunteer_signups;
CREATE POLICY "Institution updates check-in on own event signups"
  ON public.volunteer_signups FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.volunteer_events ve
      WHERE ve.id = volunteer_signups.event_id
        AND ve.institution_id = public.current_user_institution_id()
        AND public.current_user_institution_id() IS NOT NULL
    )
  );
