-- ---------------------------------------------------------------------------
-- 20260924210100_revoke_dormant_donor_offer_access.sql
--
-- The donor-offer UI and API were removed. The tables stayed, and with them
-- a PostgREST surface: authenticated sessions could still SELECT their own
-- offers and claims directly. This closes that surface without dropping the
-- schema. service_role keeps its grants so a later product decision can
-- revive the flow in a new migration.
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.donor_offers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.offer_claims FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Authors read own offers" ON public.donor_offers;
DROP POLICY IF EXISTS "Authors read claims on own offers" ON public.offer_claims;
DROP POLICY IF EXISTS "Verified members read own institution claims" ON public.offer_claims;
