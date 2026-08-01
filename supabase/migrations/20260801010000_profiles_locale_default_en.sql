-- New profiles default to English UI/email locale (anonymous visitors already
-- use the application DEFAULT_LOCALE). This timestamped filename avoids the
-- duplicate migration version that previously collided with 014_ngo_registry.
ALTER TABLE public.profiles ALTER COLUMN locale SET DEFAULT 'en';
