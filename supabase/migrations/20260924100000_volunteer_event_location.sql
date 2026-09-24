-- A volunteer event can happen somewhere other than the organisation's own
-- address (a park clean-up, a warehouse, a partner's hall).
--
-- `location` is free text the organisation types, shown to volunteers as
-- "Where". It is deliberately not geocoded and carries no coordinate: nothing
-- here may invent a point on the map (invariant 13), and the map keeps showing
-- the organisation, not its events. NULL means "at the organisation's address",
-- which is what every existing row keeps meaning.
--
-- The column inherits the table's existing grants: `authenticated` may INSERT
-- under the "Linked NGO creates volunteer events" RLS policy, `anon` may not
-- write, and both may read it like the rest of this public table.

ALTER TABLE public.volunteer_events
  ADD COLUMN IF NOT EXISTS location text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'volunteer_events_location_length'
      AND conrelid = 'public.volunteer_events'::regclass
  ) THEN
    ALTER TABLE public.volunteer_events
      ADD CONSTRAINT volunteer_events_location_length
      CHECK (location IS NULL OR char_length(btrim(location)) BETWEEN 1 AND 300);
  END IF;
END
$$;
