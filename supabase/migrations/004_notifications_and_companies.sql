-- Phase 0: ESG & CSR foundations.
-- Introduces the Company tenant model (distinct from the pre-existing
-- per-user `company` role introduced in migration 003) alongside the
-- `notifications` table that has been referenced in code since v1 but
-- was never committed as a migration.
--
-- This migration is additive and idempotent: it is safe to re-run and
-- it does not drop or rename any existing table, column, policy, or
-- function. Existing institution / NGO / individual flows are untouched.

-- ---------------------------------------------------------------------------
-- 1. notifications: per-user proximity + system notifications.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  link text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications(user_id) WHERE is_read = false;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Only the service role (supabaseAdmin) inserts notifications; individual
-- users cannot forge rows. Service role bypasses RLS so we omit an
-- explicit INSERT policy.

-- ---------------------------------------------------------------------------
-- 2. profiles: per-user locale for email + UI bilingual bundle.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS locale text DEFAULT 'hr';

-- ---------------------------------------------------------------------------
-- 3. companies: the corporate tenant. A company has a single owner
--    profile; members are attached via company_members below.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  owner_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT NOT NULL,
  legal_name text NOT NULL,
  display_name text,
  slug text UNIQUE NOT NULL,
  oib char(11) UNIQUE,
  address text,
  city text,
  country char(2) NOT NULL DEFAULT 'HR',
  logo_url text,
  brand_primary_hex text,
  brand_secondary_hex text,
  size_class text CHECK (size_class IN ('micro', 'small', 'medium', 'large')),
  csrd_wave int CHECK (csrd_wave IN (1, 2, 3)),
  prior_year_revenue_eur numeric(18, 2),
  default_match_ratio numeric(5, 4) NOT NULL DEFAULT 0,
  verified_at timestamptz,
  subscription_tier text NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'sme_tax', 'sme_plus', 'enterprise')),
  subscription_status text NOT NULL DEFAULT 'inactive',
  public_profile_enabled boolean NOT NULL DEFAULT false,
  tagline text,
  social jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_owner ON public.companies(owner_id);
CREATE INDEX IF NOT EXISTS idx_companies_slug ON public.companies(slug);

-- ---------------------------------------------------------------------------
-- 4. company_members: many-to-many profiles <-> companies with role.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_members (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'finance', 'employee')),
  department text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_company_members_company ON public.company_members(company_id);
CREATE INDEX IF NOT EXISTS idx_company_members_profile ON public.company_members(profile_id);

-- ---------------------------------------------------------------------------
-- 5. company_domains: verified email domains for auto-employee linkage.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_domains (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  domain text NOT NULL,
  verified_at timestamptz,
  dns_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain)
);

CREATE INDEX IF NOT EXISTS idx_company_domains_company ON public.company_domains(company_id);

-- ---------------------------------------------------------------------------
-- 6. company_invites: one-time email invite tokens.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.company_invites (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'employee'
    CHECK (role IN ('admin', 'finance', 'employee')),
  token text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_invites_company ON public.company_invites(company_id);
CREATE INDEX IF NOT EXISTS idx_company_invites_email ON public.company_invites(lower(email));

-- ---------------------------------------------------------------------------
-- 7. campaigns: company-scoped giving campaigns (Christmas drive, etc).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  target_amount_eur numeric(18, 2),
  sdg_tags int[] NOT NULL DEFAULT '{}',
  theme text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_company ON public.campaigns(company_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_active ON public.campaigns(is_active) WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- 8. pledges: attach optional company/campaign/match + fulfilment columns.
-- ---------------------------------------------------------------------------

ALTER TABLE public.pledges
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_of_pledge_id uuid REFERENCES public.pledges(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax_category text NOT NULL DEFAULT 'humanitarian',
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pledges_company ON public.pledges(company_id);
CREATE INDEX IF NOT EXISTS idx_pledges_campaign ON public.pledges(campaign_id);

-- ---------------------------------------------------------------------------
-- 9. volunteer_signups: check-in/out for hours capture (used in Phase 2).
--    Added in Phase 0 to avoid schema churn later.
-- ---------------------------------------------------------------------------

ALTER TABLE public.volunteer_signups
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS checked_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 10. audit_log: append-only, hash-chained audit trail for mutating
--     company-scoped routes. Write with supabaseAdmin only.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigserial PRIMARY KEY,
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  payload jsonb,
  prev_hash text,
  hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_company ON public.audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON public.audit_log(actor_profile_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_log(created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- No explicit policies: only service role reads/writes.

-- ---------------------------------------------------------------------------
-- 11. updated_at triggers on the new tables.
-- ---------------------------------------------------------------------------

-- Reuse the update_updated_at_column() function from 001_initial_schema.sql.
DROP TRIGGER IF EXISTS set_companies_updated_at ON public.companies;
CREATE TRIGGER set_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_campaigns_updated_at ON public.campaigns;
CREATE TRIGGER set_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 12. Row-level security policies.
-- ---------------------------------------------------------------------------

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- companies: members of the company read full row; owner/admin update.
-- Public-profile visibility is handled by a separate SQL view in Phase 3.

DROP POLICY IF EXISTS "Members read their company" ON public.companies;
CREATE POLICY "Members read their company"
  ON public.companies FOR SELECT
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = companies.id AND m.profile_id = auth.uid()
    )
    OR public_profile_enabled = true
  );

DROP POLICY IF EXISTS "Authenticated users can create companies" ON public.companies;
CREATE POLICY "Authenticated users can create companies"
  ON public.companies FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Owner or admin updates company" ON public.companies;
CREATE POLICY "Owner or admin updates company"
  ON public.companies FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = companies.id
        AND m.profile_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

-- company_members

DROP POLICY IF EXISTS "Members see each other" ON public.company_members;
CREATE POLICY "Members see each other"
  ON public.company_members FOR SELECT
  USING (
    profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.company_members self
      WHERE self.company_id = company_members.company_id
        AND self.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owner creates initial member" ON public.company_members;
CREATE POLICY "Owner creates initial member"
  ON public.company_members FOR INSERT
  WITH CHECK (
    -- Either the caller is becoming a member via invite acceptance...
    profile_id = auth.uid()
    -- ...or an existing owner/admin is adding them.
    OR EXISTS (
      SELECT 1 FROM public.company_members self
      WHERE self.company_id = company_members.company_id
        AND self.profile_id = auth.uid()
        AND self.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Owner or admin removes members" ON public.company_members;
CREATE POLICY "Owner or admin removes members"
  ON public.company_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members self
      WHERE self.company_id = company_members.company_id
        AND self.profile_id = auth.uid()
        AND self.role IN ('owner', 'admin')
    )
    AND profile_id <> auth.uid()
  );

-- company_domains: owner/admin scoped.

DROP POLICY IF EXISTS "Company staff manages domains" ON public.company_domains;
CREATE POLICY "Company staff manages domains"
  ON public.company_domains FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = company_domains.company_id
        AND m.profile_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Company staff inserts domains" ON public.company_domains;
CREATE POLICY "Company staff inserts domains"
  ON public.company_domains FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = company_domains.company_id
        AND m.profile_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Company staff updates domains" ON public.company_domains;
CREATE POLICY "Company staff updates domains"
  ON public.company_domains FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = company_domains.company_id
        AND m.profile_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

-- company_invites: owner/admin scoped read/write; invitees look up by token
-- via a dedicated API route that uses the service role.

DROP POLICY IF EXISTS "Company staff reads invites" ON public.company_invites;
CREATE POLICY "Company staff reads invites"
  ON public.company_invites FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = company_invites.company_id
        AND m.profile_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Company staff creates invites" ON public.company_invites;
CREATE POLICY "Company staff creates invites"
  ON public.company_invites FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = company_invites.company_id
        AND m.profile_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

-- campaigns: public read of active rows; member write.

DROP POLICY IF EXISTS "Public reads active campaigns" ON public.campaigns;
CREATE POLICY "Public reads active campaigns"
  ON public.campaigns FOR SELECT
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = campaigns.company_id
        AND m.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Company staff manages campaigns" ON public.campaigns;
CREATE POLICY "Company staff manages campaigns"
  ON public.campaigns FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = campaigns.company_id
        AND m.profile_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Company staff updates campaigns" ON public.campaigns;
CREATE POLICY "Company staff updates campaigns"
  ON public.campaigns FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = campaigns.company_id
        AND m.profile_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

-- pledges: preserve existing policies; extend so company members can read
-- any pledge tagged to their company (for dashboard visibility).

DROP POLICY IF EXISTS "Company members view company pledges" ON public.pledges;
CREATE POLICY "Company members view company pledges"
  ON public.pledges FOR SELECT
  USING (
    company_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = pledges.company_id
        AND m.profile_id = auth.uid()
    )
  );
