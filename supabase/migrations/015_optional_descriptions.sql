-- 015: relax NOT NULL on description columns for needs and volunteer_events.
-- The product calls for description to be optional on the NGO posting forms;
-- migration 001 created both columns as `text not null`. Idempotent.

ALTER TABLE public.needs            ALTER COLUMN description DROP NOT NULL;
ALTER TABLE public.volunteer_events ALTER COLUMN description DROP NOT NULL;
