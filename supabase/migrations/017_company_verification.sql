-- =============================================================
-- 017: Company verification (OIB lookup via SudReg + email confirm)
-- =============================================================
-- Tracks an in-flight verification of a company's identity. Successful
-- verification stamps the existing companies.verified_at column (added in
-- migration 004) — this table is the audit trail and ephemeral state.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.company_verifications (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Snapshot from SudReg /detalji_subjekta. Stored once at request time so
  -- the user can review what we got even if SudReg rate-limits a refresh.
  sudreg_legal_name     text NOT NULL,
  sudreg_short_name     text,
  sudreg_address        text,
  sudreg_city           text,
  sudreg_legal_form     text,
  sudreg_status         int,             -- SudReg `status` (1 = active)
  sudreg_mb             text,
  sudreg_mbs            text,
  sudreg_oib            char(11) NOT NULL,
  sudreg_fetched_at     timestamptz NOT NULL DEFAULT now(),

  -- Email confirmation channel.
  contact_email         text NOT NULL,
  token                 text UNIQUE NOT NULL,
  expires_at            timestamptz NOT NULL,
  confirmed_at          timestamptz,
  confirmed_ip          text,

  -- Provenance.
  created_by            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_verifications_company
  ON public.company_verifications(company_id);
CREATE INDEX IF NOT EXISTS idx_company_verifications_token
  ON public.company_verifications(token)
  WHERE confirmed_at IS NULL;

-- Only one in-flight (un-confirmed) verification per company at a time.
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_verification_per_company
  ON public.company_verifications(company_id)
  WHERE confirmed_at IS NULL;

ALTER TABLE public.company_verifications ENABLE ROW LEVEL SECURITY;

-- Helper: is the caller a member of this company with sufficient role?
-- (Mirrors the pattern used by company_members policies via
-- requireMembership in src/lib/companies.ts — kept consistent at SQL level
-- so direct PostgREST reads work too.)
DROP POLICY IF EXISTS "Members read own company verifications" ON public.company_verifications;
CREATE POLICY "Members read own company verifications"
  ON public.company_verifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = company_verifications.company_id
        AND cm.profile_id = auth.uid()
    )
  );

-- Inserts and confirms always go through the service-role API; no
-- INSERT / UPDATE policies for `authenticated`. The /verify-company route
-- consumes the token via supabaseAdmin so it doesn't need an RLS path.
