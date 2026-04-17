-- Allow authenticated NGO profiles without an institution yet to create their
-- institution row (OAuth /auth/setup path). Trigger-based email signup already
-- inserts via SECURITY DEFINER; this policy fixes client-side setup inserts
-- that were blocked by RLS with no INSERT policy on public.institutions.

DROP POLICY IF EXISTS "NGO without institution may create institution" ON public.institutions;

CREATE POLICY "NGO without institution may create institution"
  ON public.institutions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.institution_id IS NULL
        AND p.role = 'ngo'
    )
  );
