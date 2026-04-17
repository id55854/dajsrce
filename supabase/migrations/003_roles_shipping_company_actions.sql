-- Expand role model for startup-ready multi-tenant flows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND constraint_type = 'CHECK'
      AND constraint_name = 'profiles_role_check'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
  END IF;
END $$;

ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'individual';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('individual', 'ngo', 'company', 'superadmin'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS organization_verified boolean DEFAULT false;

-- Company support actions + printable confirmations.
CREATE TABLE IF NOT EXISTS public.company_actions (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  company_profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  company_name text NOT NULL,
  ngo_name text NOT NULL,
  support_type text NOT NULL,
  status text NOT NULL DEFAULT 'confirmed',
  note text,
  confirmation_slug text UNIQUE NOT NULL,
  shipment_method text NOT NULL DEFAULT 'courier_pickup',
  created_at timestamptz DEFAULT now()
);

-- Shipping abstraction (provider-agnostic, mockable now, integratable later).
CREATE TABLE IF NOT EXISTS public.shipments (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  pledge_id uuid REFERENCES public.pledges(id) ON DELETE CASCADE NOT NULL,
  donor_profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  ngo_institution_id uuid REFERENCES public.institutions(id) ON DELETE CASCADE NOT NULL,
  method text NOT NULL CHECK (
    method IN (
      'self_dropoff',
      'courier_pickup',
      'parcel_locker',
      'ngo_pickup',
      'third_party_partner'
    )
  ),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending',
      'label_created',
      'dropped_off',
      'in_transit',
      'delivered',
      'confirmed_by_ngo',
      'failed',
      'cancelled'
    )
  ),
  carrier_name text,
  tracking_number text,
  dropoff_location text,
  donor_note text,
  expected_delivery_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_actions_profile
  ON public.company_actions(company_profile_id);
CREATE INDEX IF NOT EXISTS idx_company_actions_slug
  ON public.company_actions(confirmation_slug);
CREATE INDEX IF NOT EXISTS idx_shipments_pledge
  ON public.shipments(pledge_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status
  ON public.shipments(status);

ALTER TABLE public.company_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users can view own actions"
  ON public.company_actions
  FOR SELECT
  USING (auth.uid() = company_profile_id);

CREATE POLICY "Company users can insert own actions"
  ON public.company_actions
  FOR INSERT
  WITH CHECK (auth.uid() = company_profile_id);

CREATE POLICY "Donors can view own shipments"
  ON public.shipments
  FOR SELECT
  USING (auth.uid() = donor_profile_id);

CREATE POLICY "Donors can create shipments"
  ON public.shipments
  FOR INSERT
  WITH CHECK (auth.uid() = donor_profile_id);
