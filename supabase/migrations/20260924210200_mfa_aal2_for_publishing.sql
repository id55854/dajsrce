-- ---------------------------------------------------------------------------
-- 20260924210200_mfa_aal2_for_publishing.sql
--
-- Linked NGOs can insert needs and volunteer events through PostgREST, not
-- only through the application API. The API refuses a password-only session;
-- these policies do the same for a direct call. service_role bypasses RLS,
-- and the API routes that use it check the session before they write.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Linked NGO creates needs" ON public.needs;
CREATE POLICY "Linked NGO creates needs"
  ON public.needs FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_institution_id() IS NOT NULL
    AND institution_id = public.current_user_institution_id()
    AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  );

DROP POLICY IF EXISTS "Linked NGO updates own needs" ON public.needs;
CREATE POLICY "Linked NGO updates own needs"
  ON public.needs FOR UPDATE TO authenticated
  USING (
    public.current_user_institution_id() IS NOT NULL
    AND institution_id = public.current_user_institution_id()
    AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  )
  WITH CHECK (
    public.current_user_institution_id() IS NOT NULL
    AND institution_id = public.current_user_institution_id()
    AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  );

DROP POLICY IF EXISTS "Linked NGO creates volunteer events" ON public.volunteer_events;
CREATE POLICY "Linked NGO creates volunteer events"
  ON public.volunteer_events FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_institution_id() IS NOT NULL
    AND institution_id = public.current_user_institution_id()
    AND coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
  );
