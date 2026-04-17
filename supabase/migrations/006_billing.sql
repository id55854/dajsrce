-- Phase 1: Stripe subscription mirror + webhook idempotency.
-- Additive only; safe to re-run.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  tier text,
  status text,
  current_period_end timestamptz,
  cancel_at timestamptz,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON public.subscriptions(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company staff reads subscription" ON public.subscriptions;
CREATE POLICY "Company staff reads subscription"
  ON public.subscriptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = subscriptions.company_id
      AND m.profile_id = auth.uid()
      AND m.role IN ('owner', 'admin', 'finance')
    )
  );

CREATE TABLE IF NOT EXISTS public.stripe_events (
  id text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now(),
  type text,
  payload jsonb
);

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
-- No policies: user JWT cannot read; service role bypasses.

DROP TRIGGER IF EXISTS set_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
