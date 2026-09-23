-- Live pledge and volunteer counts on the public cards.
--
-- The cards subscribe to UPDATE events on these two tables and read only the
-- counter columns (quantity_needed / quantity_pledged / is_fulfilled and
-- volunteers_needed / volunteers_signed_up). Both tables are already public:
-- "Needs are viewable by everyone" and "Events are viewable by everyone"
-- (001), and /api/needs and /api/volunteer-events return every column the
-- change payload carries, so publishing them exposes nothing new.
--
-- Capacity itself is still decided by create_pledge_transaction and
-- volunteer_signup_transaction under a row lock; this only mirrors it.
--
-- Guarded so a database without the Supabase Realtime publication and a
-- re-run are both no-ops.

DO $$
DECLARE
  target text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    RETURN;
  END IF;

  FOREACH target IN ARRAY ARRAY['needs', 'volunteer_events'] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = target
    ) THEN
      EXECUTE pg_catalog.format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target);
    END IF;
  END LOOP;
END
$$;
