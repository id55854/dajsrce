-- Push new notifications to the signed-in browser instead of waiting for a
-- page load or for the bell to be opened.
--
-- Realtime `postgres_changes` checks the subscriber's SELECT policy on every
-- row it forwards, and "Users read own notifications" (004) is
-- `auth.uid() = user_id`, so a visitor only ever receives their own rows. The
-- browser uses the event as a signal and re-reads the list through
-- /api/notifications, which keeps the explicit column list.
--
-- Guarded so a database without the Supabase Realtime publication (a plain
-- local Postgres) and a re-run are both no-ops.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END
$$;
