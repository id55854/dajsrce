-- Close the direct-write hole on needs and volunteer events.
--
-- Production carried two hand-applied policies, "Authenticated users can
-- update need counters" and "Authenticated users can update event counters":
-- FOR UPDATE, roles {public}, USING (true) WITH CHECK (true). Together with the
-- table-wide UPDATE grant `authenticated` holds on both tables, any signed-in
-- person could take the Data API token from /api/auth/data-token and PATCH
-- any organisation's need or event: title, date, capacity, even
-- institution_id. Reproduced on a branch on 2026-09-26 as role
-- `authenticated` with no identity at all.
--
-- Nothing in the application needs those writes. Counters move only inside
-- the service-role transaction RPCs (SECURITY DEFINER, owner privileges);
-- organisations create needs and events with INSERT under the "Linked NGO
-- creates ..." policies, which stay; there is no edit path for either table.
-- Deleting goes through delete_need_transaction /
-- delete_volunteer_event_transaction (service role).
--
-- An institution's registered name and its reviewed category are not the
-- organisation's to rewrite either (invariants 8 and 13): the name comes from
-- the official register and the category from the reviewed classification.
-- The presentational columns an organisation may maintain keep their grant.

DROP POLICY IF EXISTS "Authenticated users can update need counters" ON public.needs;
DROP POLICY IF EXISTS "Authenticated users can update event counters" ON public.volunteer_events;

-- No UPDATE policy that the application relies on remains for callers below
-- service_role; revoking the privilege as well makes a future permissive
-- policy harmless instead of silently re-opening the hole.
DROP POLICY IF EXISTS "Linked NGO updates own needs" ON public.needs;
REVOKE UPDATE ON public.needs FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON public.volunteer_events FROM PUBLIC, anon, authenticated;

REVOKE UPDATE (name, category) ON public.institutions FROM PUBLIC, anon, authenticated;
