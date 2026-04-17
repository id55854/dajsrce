-- Phase 1: pledge acknowledgements, donation receipts, EUR amounts.
-- Additive only; safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Pledges: EUR value + delivered timestamp (for auto-acknowledge window).
-- ---------------------------------------------------------------------------

ALTER TABLE public.pledges
  ADD COLUMN IF NOT EXISTS amount_eur numeric(18, 2),
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

COMMENT ON COLUMN public.pledges.amount_eur IS 'Declared donation value in EUR for tax receipt line items.';
COMMENT ON COLUMN public.pledges.delivered_at IS 'When the institution (or donor) marked the pledge as physically delivered.';

-- ---------------------------------------------------------------------------
-- 2. Institutions: optional OIB for receipt beneficiary block.
-- ---------------------------------------------------------------------------

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS oib char(11);

-- ---------------------------------------------------------------------------
-- 3. pledge_acknowledgements: institution verification of delivery.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pledge_acknowledgements (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  pledge_id uuid NOT NULL REFERENCES public.pledges(id) ON DELETE CASCADE,
  institution_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'auto')),
  notes text,
  delivery_photo_url text,
  signature_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pledge_id)
);

CREATE INDEX IF NOT EXISTS idx_pledge_ack_pledge ON public.pledge_acknowledgements(pledge_id);

ALTER TABLE public.pledge_acknowledgements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Ack read donor or company" ON public.pledge_acknowledgements;
CREATE POLICY "Ack read donor or company"
  ON public.pledge_acknowledgements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pledges p
      WHERE p.id = pledge_acknowledgements.pledge_id
      AND (
        p.user_id = auth.uid()
        OR (
          p.company_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.company_members cm
            WHERE cm.company_id = p.company_id AND cm.profile_id = auth.uid()
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS "Ack read institution staff" ON public.pledge_acknowledgements;
CREATE POLICY "Ack read institution staff"
  ON public.pledge_acknowledgements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pledges p
      JOIN public.needs n ON n.id = p.need_id
      JOIN public.profiles pr ON pr.id = auth.uid()
      WHERE p.id = pledge_acknowledgements.pledge_id
      AND pr.institution_id = n.institution_id
      AND pr.role = 'ngo'
    )
  );

DROP POLICY IF EXISTS "Institution can insert manual ack" ON public.pledge_acknowledgements;
CREATE POLICY "Institution can insert manual ack"
  ON public.pledge_acknowledgements FOR INSERT
  WITH CHECK (
    kind = 'manual'
    AND institution_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.pledges p
      JOIN public.needs n ON n.id = p.need_id
      JOIN public.profiles pr ON pr.id = auth.uid()
      WHERE p.id = pledge_acknowledgements.pledge_id
      AND pr.institution_id = n.institution_id
      AND pr.role = 'ngo'
      AND p.status = 'delivered'
    )
  );

-- Auto-ack rows are inserted with the service role (bypasses RLS).

-- ---------------------------------------------------------------------------
-- 4. donation_receipts: fiscal-year PDF/XML artefacts for companies.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.donation_receipts (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fiscal_year int NOT NULL,
  version int NOT NULL DEFAULT 1,
  generated_at timestamptz NOT NULL DEFAULT now(),
  pdf_url text,
  xml_url text,
  total_amount_eur numeric(18, 2),
  ceiling_pct numeric(5, 2),
  ceiling_consumed_pct numeric(7, 4),
  manifest_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, fiscal_year, version)
);

CREATE INDEX IF NOT EXISTS idx_donation_receipts_company_fy
  ON public.donation_receipts(company_id, fiscal_year DESC);

ALTER TABLE public.donation_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Receipts read company finance" ON public.donation_receipts;
CREATE POLICY "Receipts read company finance"
  ON public.donation_receipts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = donation_receipts.company_id
      AND cm.profile_id = auth.uid()
      AND cm.role IN ('owner', 'admin', 'finance')
    )
  );

-- Inserts/updates use supabaseAdmin only.

-- ---------------------------------------------------------------------------
-- 5. Private storage bucket for receipt PDFs/XML/evidence (uploads via API).
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('receipts', 'receipts', false, 52428800)
ON CONFLICT (id) DO NOTHING;
