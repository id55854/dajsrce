-- Allow volunteers to mark their own arrival (QR / self-service check-in).
-- Check-out and volunteer_hours remain institution-coordinated via API + service role.

DROP POLICY IF EXISTS "Volunteer self check-in times" ON public.volunteer_signups;
CREATE POLICY "Volunteer self check-in times"
  ON public.volunteer_signups FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
