-- Only an `ngo` profile may hold an organisation (invariant 13).
--
-- Nine legacy `individual` profiles from the typed-name onboarding era
-- (2026-04) still carried an institution_id pointing at an unverified
-- typed-name institution. They could not claim a real organisation and, until
-- 20260926110000, the pledge read policy let them see that institution's
-- donors. Unlink them and make the rule structural. Idempotent, so it is safe
-- next to the one-off pre-launch cleanup script, which also removes the
-- typed-name institutions themselves.

UPDATE public.profiles
SET institution_id = NULL
WHERE role <> 'ngo' AND institution_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_institution_requires_ngo'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_institution_requires_ngo
      CHECK (institution_id IS NULL OR role = 'ngo');
  END IF;
END;
$$;
