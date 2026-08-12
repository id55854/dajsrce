-- Citizen donation offers.
--
-- Until now the platform only flowed one way: an organisation published a
-- `need` and a donor pledged against it. This migration adds the reverse
-- direction — a private individual publishes what they can give and a verified
-- organisation asks for it.
--
-- Two privacy rules shape the whole design and must survive any future change:
--
--   1. The author is a private individual, so no exact street address and no
--      exact coordinate is ever stored. The create RPC snaps the submitted
--      point onto the same ~5 km grid `set_institution_public_location` uses
--      for hidden institutions and persists only that projection; the table has
--      no column an exact point could live in. City is the coarsest and the
--      default level of detail.
--   2. Contact details are never part of the browsing surface. They are
--      released by the read RPCs only for a claim the author has accepted, and
--      only to the two parties on that claim.
--
-- Registry presence is not organizational confirmation, so browsing and
-- claiming require `institutions.is_verified = true` AND the caller being a
-- member of that institution. `current_user_institution_id()` carries that
-- membership check for RLS (where `auth.uid()` is populated); the service-only
-- RPCs resolve the identical membership from `p_actor_id` because the service
-- role has no `auth.uid()`.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Coarse location projection.
--
-- Same grid and hash-derived offset as `set_institution_public_location`, so a
-- published point is stable for a given offer, is never the submitted point,
-- and cannot be de-anonymised by re-reading the row.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.coarse_donor_offer_point(
  p_seed text,
  p_lat double precision,
  p_lng double precision,
  OUT coarse_lat double precision,
  OUT coarse_lng double precision
)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  grid_size constant double precision := 0.05;
  lat_offset double precision;
  lng_offset double precision;
BEGIN
  IF p_seed IS NULL OR p_lat IS NULL OR p_lng IS NULL
     OR p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
    coarse_lat := NULL;
    coarse_lng := NULL;
    RETURN;
  END IF;

  lat_offset := 0.01 + (
    mod(abs(hashtextextended(p_seed || ':lat', 0)::numeric), 3000)::double precision
    / 100000.0
  );
  lng_offset := 0.01 + (
    mod(abs(hashtextextended(p_seed || ':lng', 0)::numeric), 3000)::double precision
    / 100000.0
  );

  coarse_lat := floor((p_lat + 90.0) / grid_size) * grid_size - 90.0 + lat_offset;
  coarse_lng := floor((p_lng + 180.0) / grid_size) * grid_size - 180.0 + lng_offset;

  -- Absolute privacy invariant: never publish the submitted point, even in the
  -- unlikely event that it already equals the hash-derived display point.
  IF coarse_lat = p_lat AND coarse_lng = p_lng THEN
    coarse_lat := coarse_lat + CASE WHEN lat_offset <= 0.034 THEN 0.005 ELSE -0.005 END;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.coarse_donor_offer_point(text, double precision, double precision)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coarse_donor_offer_point(text, double precision, double precision)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Tables.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.donor_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  donation_type text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  unit text,
  city text NOT NULL,
  -- Coarse projection only. There is deliberately no `lat`/`lng` pair and no
  -- address column: a private individual's home must not be storable here.
  coarse_lat double precision,
  coarse_lng double precision,
  available_until date,
  status text NOT NULL DEFAULT 'open',
  claimed_institution_id uuid REFERENCES public.institutions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT donor_offers_title_bounded CHECK (char_length(title) BETWEEN 3 AND 120),
  CONSTRAINT donor_offers_description_bounded CHECK (char_length(description) <= 2000),
  CONSTRAINT donor_offers_city_bounded CHECK (char_length(city) BETWEEN 2 AND 120),
  CONSTRAINT donor_offers_unit_bounded CHECK (unit IS NULL OR char_length(unit) BETWEEN 1 AND 32),
  CONSTRAINT donor_offers_quantity_bounded CHECK (quantity BETWEEN 1 AND 100000),
  CONSTRAINT donor_offers_donation_type_known CHECK (donation_type IN (
    'clothes', 'food', 'hygiene', 'toys_books', 'school_supplies', 'furniture',
    'medical_supplies', 'baby_items', 'blankets_bedding', 'money', 'time'
  )),
  CONSTRAINT donor_offers_status_known CHECK (status IN (
    'open', 'claimed', 'withdrawn', 'fulfilled', 'expired'
  )),
  CONSTRAINT donor_offers_coarse_point_paired CHECK (
    (coarse_lat IS NULL AND coarse_lng IS NULL)
    OR (coarse_lat BETWEEN -90 AND 90 AND coarse_lng BETWEEN -180 AND 180)
  ),
  CONSTRAINT donor_offers_claim_matches_status CHECK (
    claimed_institution_id IS NULL OR status IN ('claimed', 'fulfilled')
  )
);

COMMENT ON COLUMN public.donor_offers.coarse_lat IS
  'Grid-snapped display latitude produced by coarse_donor_offer_point. Never the submitted point.';
COMMENT ON COLUMN public.donor_offers.coarse_lng IS
  'Grid-snapped display longitude produced by coarse_donor_offer_point. Never the submitted point.';

CREATE TABLE IF NOT EXISTS public.offer_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.donor_offers(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  claimed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested',
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT offer_claims_message_bounded CHECK (message IS NULL OR char_length(message) <= 1000),
  CONSTRAINT offer_claims_status_known CHECK (status IN (
    'requested', 'accepted', 'declined', 'withdrawn'
  )),
  CONSTRAINT offer_claims_responded_when_settled CHECK (
    (status = 'requested' AND responded_at IS NULL)
    OR (status <> 'requested' AND responded_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_donor_offers_open_created
  ON public.donor_offers(created_at DESC)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_donor_offers_author_created
  ON public.donor_offers(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_donor_offers_open_type_city
  ON public.donor_offers(donation_type, lower(city))
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_donor_offers_expiry_sweep
  ON public.donor_offers(available_until)
  WHERE status = 'open' AND available_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offer_claims_offer_status
  ON public.offer_claims(offer_id, status);
CREATE INDEX IF NOT EXISTS idx_offer_claims_institution_created
  ON public.offer_claims(institution_id, created_at DESC);

-- One live request per institution per offer, and at most one accepted claim.
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_claims_live_per_institution
  ON public.offer_claims(offer_id, institution_id)
  WHERE status IN ('requested', 'accepted');
CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_claims_accepted_per_offer
  ON public.offer_claims(offer_id)
  WHERE status = 'accepted';

-- ---------------------------------------------------------------------------
-- 3. RLS and explicit column privileges.
--
-- RLS decides which rows; column privileges decide which attributes. Direct
-- PostgREST access is restricted to the author's own rows — organisation-side
-- browsing goes exclusively through the bounded RPCs below, which enforce the
-- verification gate. `anon` gets nothing at all.
-- ---------------------------------------------------------------------------

ALTER TABLE public.donor_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.donor_offers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.offer_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.donor_offers TO service_role;
GRANT ALL ON public.offer_claims TO service_role;

GRANT SELECT (
  id, user_id, title, description, donation_type, quantity, unit, city,
  coarse_lat, coarse_lng, available_until, status, claimed_institution_id,
  created_at, updated_at
) ON public.donor_offers TO authenticated;

-- `claimed_by` is a staff member's profile id and is never part of any read
-- surface, so it is excluded from the grant rather than merely from the DTO.
GRANT SELECT (
  id, offer_id, institution_id, status, message, created_at, responded_at
) ON public.offer_claims TO authenticated;

DROP POLICY IF EXISTS "Authors read own offers" ON public.donor_offers;
CREATE POLICY "Authors read own offers"
  ON public.donor_offers FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Authors read claims on own offers" ON public.offer_claims;
CREATE POLICY "Authors read claims on own offers"
  ON public.offer_claims FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.donor_offers o
    WHERE o.id = offer_claims.offer_id AND o.user_id = auth.uid()
  ));

-- A verified organisation's members see the claims their own organisation made.
-- Registry presence alone is not confirmation, so `is_verified` is required
-- here exactly as it is inside the transactional RPCs.
DROP POLICY IF EXISTS "Verified members read own institution claims" ON public.offer_claims;
CREATE POLICY "Verified members read own institution claims"
  ON public.offer_claims FOR SELECT
  TO authenticated
  USING (
    offer_claims.institution_id = public.current_user_institution_id()
    AND EXISTS (
      SELECT 1 FROM public.institutions i
      WHERE i.id = offer_claims.institution_id AND i.is_verified = true
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Shared projections.
--
-- Two explicit DTO builders keep every read path on the same column list, so a
-- new column cannot leak by being added to a `to_jsonb(row)` somewhere.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.donor_offer_public_dto(p_offer public.donor_offers)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  -- No user_id, no contact details, no exact point: the browsing surface.
  SELECT jsonb_build_object(
    'id', p_offer.id,
    'title', p_offer.title,
    'description', p_offer.description,
    'donation_type', p_offer.donation_type,
    'quantity', p_offer.quantity,
    'unit', p_offer.unit,
    'city', p_offer.city,
    'coarse_lat', p_offer.coarse_lat,
    'coarse_lng', p_offer.coarse_lng,
    'available_until', p_offer.available_until,
    'status', p_offer.status,
    'created_at', p_offer.created_at
  );
$$;

CREATE OR REPLACE FUNCTION public.donor_offer_author_dto(p_offer public.donor_offers)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT public.donor_offer_public_dto(p_offer) || jsonb_build_object(
    'claimed_institution_id', p_offer.claimed_institution_id,
    'updated_at', p_offer.updated_at
  );
$$;

REVOKE ALL ON FUNCTION public.donor_offer_public_dto(public.donor_offers)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.donor_offer_author_dto(public.donor_offers)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.donor_offer_public_dto(public.donor_offers) TO service_role;
GRANT EXECUTE ON FUNCTION public.donor_offer_author_dto(public.donor_offers) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Membership gate. Resolves and verifies the caller's organisation from
--    `p_actor_id` only. Never from user metadata, a request body or a flag.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verified_offer_institution_for_actor(p_actor_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
DECLARE
  v_institution_id uuid;
  v_role text;
  v_is_verified boolean;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT p.institution_id, p.role INTO v_institution_id, v_role
  FROM public.profiles p
  WHERE p.id = p_actor_id;

  IF NOT FOUND OR v_role <> 'ngo' OR v_institution_id IS NULL THEN
    RAISE EXCEPTION 'organisation membership required' USING ERRCODE = '42501';
  END IF;

  SELECT i.is_verified INTO v_is_verified
  FROM public.institutions i
  WHERE i.id = v_institution_id;

  IF NOT FOUND OR coalesce(v_is_verified, false) = false THEN
    RAISE EXCEPTION 'organisation is not verified' USING ERRCODE = '42501';
  END IF;

  RETURN v_institution_id;
END;
$$;

REVOKE ALL ON FUNCTION public.verified_offer_institution_for_actor(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verified_offer_institution_for_actor(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Create. The submitted point is projected and discarded in the same
--    statement that inserts the row.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_donor_offer_transaction(
  p_actor_id uuid,
  p_title text,
  p_description text,
  p_donation_type text,
  p_quantity integer,
  p_unit text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_available_until date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_offer_id uuid := gen_random_uuid();
  v_offer public.donor_offers%ROWTYPE;
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_unit text := nullif(btrim(coalesce(p_unit, '')), '');
  v_city text := btrim(coalesce(p_city, ''));
  v_open_offers integer;
  v_coarse_lat double precision;
  v_coarse_lng double precision;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id) THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '23503';
  END IF;
  IF char_length(v_title) < 3 OR char_length(v_title) > 120 THEN
    RAISE EXCEPTION 'title must contain 3 to 120 characters' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_description) > 2000 THEN
    RAISE EXCEPTION 'description too long' USING ERRCODE = '22023';
  END IF;
  IF p_donation_type IS NULL OR p_donation_type NOT IN (
    'clothes', 'food', 'hygiene', 'toys_books', 'school_supplies', 'furniture',
    'medical_supplies', 'baby_items', 'blankets_bedding', 'money', 'time'
  ) THEN
    RAISE EXCEPTION 'invalid donation type' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 100000 THEN
    RAISE EXCEPTION 'quantity must be an integer between 1 and 100000' USING ERRCODE = '22023';
  END IF;
  IF v_unit IS NOT NULL AND char_length(v_unit) > 32 THEN
    RAISE EXCEPTION 'unit too long' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_city) < 2 OR char_length(v_city) > 120 THEN
    RAISE EXCEPTION 'city must contain 2 to 120 characters' USING ERRCODE = '22023';
  END IF;
  IF p_available_until IS NOT NULL
     AND (p_available_until < current_date OR p_available_until > current_date + 365) THEN
    RAISE EXCEPTION 'available_until must fall within the next year' USING ERRCODE = '22023';
  END IF;

  -- Cheap abuse bound; an author with a backlog of untouched offers cannot
  -- flood the organisation-facing list.
  SELECT count(*)::integer INTO v_open_offers
  FROM public.donor_offers
  WHERE user_id = p_actor_id AND status = 'open';
  IF v_open_offers >= 50 THEN
    RAISE EXCEPTION 'too many open offers' USING ERRCODE = '23514';
  END IF;

  SELECT c.coarse_lat, c.coarse_lng INTO v_coarse_lat, v_coarse_lng
  FROM public.coarse_donor_offer_point(v_offer_id::text, p_latitude, p_longitude) c;

  INSERT INTO public.donor_offers(
    id, user_id, title, description, donation_type, quantity, unit, city,
    coarse_lat, coarse_lng, available_until, status
  ) VALUES (
    v_offer_id, p_actor_id, v_title, v_description, p_donation_type, p_quantity,
    v_unit, v_city, v_coarse_lat, v_coarse_lng, p_available_until, 'open'
  )
  RETURNING * INTO v_offer;

  RETURN public.donor_offer_author_dto(v_offer);
END;
$$;

REVOKE ALL ON FUNCTION public.create_donor_offer_transaction(
  uuid, text, text, text, integer, text, text, double precision, double precision, date
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_donor_offer_transaction(
  uuid, text, text, text, integer, text, text, double precision, double precision, date
) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Author edits and lifecycle transitions.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_donor_offer_transaction(
  p_actor_id uuid,
  p_offer_id uuid,
  p_title text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_quantity integer DEFAULT NULL,
  p_unit text DEFAULT NULL,
  p_available_until date DEFAULT NULL,
  p_clear_available_until boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_offer public.donor_offers%ROWTYPE;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_unit text := nullif(btrim(coalesce(p_unit, '')), '');
BEGIN
  SELECT * INTO v_offer FROM public.donor_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_offer.user_id <> p_actor_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_offer.status <> 'open' THEN
    RAISE EXCEPTION 'offer is no longer open' USING ERRCODE = '23514';
  END IF;

  IF v_title IS NOT NULL AND char_length(v_title) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'title must contain 3 to 120 characters' USING ERRCODE = '22023';
  END IF;
  IF p_description IS NOT NULL AND char_length(btrim(p_description)) > 2000 THEN
    RAISE EXCEPTION 'description too long' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NOT NULL AND (p_quantity < 1 OR p_quantity > 100000) THEN
    RAISE EXCEPTION 'quantity must be an integer between 1 and 100000' USING ERRCODE = '22023';
  END IF;
  IF v_unit IS NOT NULL AND char_length(v_unit) > 32 THEN
    RAISE EXCEPTION 'unit too long' USING ERRCODE = '22023';
  END IF;
  IF p_available_until IS NOT NULL
     AND (p_available_until < current_date OR p_available_until > current_date + 365) THEN
    RAISE EXCEPTION 'available_until must fall within the next year' USING ERRCODE = '22023';
  END IF;

  UPDATE public.donor_offers
  SET title = coalesce(v_title, title),
      description = coalesce(btrim(p_description), description),
      quantity = coalesce(p_quantity, quantity),
      unit = CASE WHEN p_unit IS NULL THEN unit ELSE v_unit END,
      available_until = CASE
        WHEN p_clear_available_until THEN NULL
        ELSE coalesce(p_available_until, available_until)
      END,
      updated_at = now()
  WHERE id = p_offer_id
  RETURNING * INTO v_offer;

  RETURN public.donor_offer_author_dto(v_offer);
END;
$$;

REVOKE ALL ON FUNCTION public.update_donor_offer_transaction(
  uuid, uuid, text, text, integer, text, date, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_donor_offer_transaction(
  uuid, uuid, text, text, integer, text, date, boolean
) TO service_role;

CREATE OR REPLACE FUNCTION public.set_donor_offer_status_transaction(
  p_actor_id uuid,
  p_offer_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_offer public.donor_offers%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('withdrawn', 'fulfilled') THEN
    RAISE EXCEPTION 'invalid offer status transition' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_offer FROM public.donor_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_offer.user_id <> p_actor_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_offer.status NOT IN ('open', 'claimed') THEN
    RAISE EXCEPTION 'offer is already closed' USING ERRCODE = '23514';
  END IF;
  IF p_status = 'fulfilled' AND v_offer.status <> 'claimed' THEN
    RAISE EXCEPTION 'only a claimed offer can be fulfilled' USING ERRCODE = '23514';
  END IF;

  -- Withdrawing releases every organisation still waiting for an answer under
  -- the same lock, so nobody is left with a request against a dead offer.
  IF p_status = 'withdrawn' THEN
    UPDATE public.offer_claims
    SET status = 'declined', responded_at = v_now
    WHERE offer_id = p_offer_id AND status = 'requested';
  END IF;

  UPDATE public.donor_offers
  SET status = p_status,
      claimed_institution_id = CASE WHEN p_status = 'withdrawn' THEN NULL ELSE claimed_institution_id END,
      updated_at = v_now
  WHERE id = p_offer_id
  RETURNING * INTO v_offer;

  RETURN public.donor_offer_author_dto(v_offer);
END;
$$;

REVOKE ALL ON FUNCTION public.set_donor_offer_status_transaction(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_donor_offer_status_transaction(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Claims. An organisation requests; the author answers.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_donor_offer_transaction(
  p_actor_id uuid,
  p_offer_id uuid,
  p_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_offer public.donor_offers%ROWTYPE;
  v_institution_id uuid;
  v_claim public.offer_claims%ROWTYPE;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
BEGIN
  IF v_message IS NOT NULL AND char_length(v_message) > 1000 THEN
    RAISE EXCEPTION 'message too long' USING ERRCODE = '22023';
  END IF;

  -- Authorization is resolved inside the transaction from the actor id alone.
  v_institution_id := public.verified_offer_institution_for_actor(p_actor_id);

  SELECT * INTO v_offer FROM public.donor_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_offer.user_id = p_actor_id THEN
    RAISE EXCEPTION 'an author cannot claim their own offer' USING ERRCODE = '23514';
  END IF;
  IF v_offer.status <> 'open' THEN
    RAISE EXCEPTION 'offer is no longer open' USING ERRCODE = '23514';
  END IF;
  IF v_offer.available_until IS NOT NULL AND v_offer.available_until < current_date THEN
    RAISE EXCEPTION 'offer has expired' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.offer_claims
    WHERE offer_id = p_offer_id
      AND institution_id = v_institution_id
      AND status IN ('requested', 'accepted')
  ) THEN
    RAISE EXCEPTION 'organisation already requested this offer' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.offer_claims(offer_id, institution_id, claimed_by, status, message)
  VALUES (p_offer_id, v_institution_id, p_actor_id, 'requested', v_message)
  RETURNING * INTO v_claim;

  RETURN jsonb_build_object(
    'id', v_claim.id,
    'offer_id', v_claim.offer_id,
    'institution_id', v_claim.institution_id,
    'status', v_claim.status,
    'message', v_claim.message,
    'created_at', v_claim.created_at,
    'responded_at', v_claim.responded_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_donor_offer_transaction(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_donor_offer_transaction(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.withdraw_offer_claim_transaction(
  p_actor_id uuid,
  p_claim_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim public.offer_claims%ROWTYPE;
  v_offer_id uuid;
  v_institution_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  v_institution_id := public.verified_offer_institution_for_actor(p_actor_id);

  SELECT c.offer_id INTO v_offer_id FROM public.offer_claims c WHERE c.id = p_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found' USING ERRCODE = 'P0002';
  END IF;

  -- Parent first, then the claim: the same lock order the author's response
  -- takes, so the two paths cannot deadlock against each other.
  PERFORM 1 FROM public.donor_offers WHERE id = v_offer_id FOR UPDATE;
  SELECT c.* INTO v_claim FROM public.offer_claims c WHERE c.id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_claim.institution_id <> v_institution_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_claim.status <> 'requested' THEN
    RAISE EXCEPTION 'claim has already been answered' USING ERRCODE = '23514';
  END IF;

  UPDATE public.offer_claims
  SET status = 'withdrawn', responded_at = v_now
  WHERE id = p_claim_id
  RETURNING * INTO v_claim;

  RETURN jsonb_build_object(
    'id', v_claim.id,
    'offer_id', v_claim.offer_id,
    'institution_id', v_claim.institution_id,
    'status', v_claim.status,
    'responded_at', v_claim.responded_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_offer_claim_transaction(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_offer_claim_transaction(uuid, uuid) TO service_role;

-- Accepting one request declines every other outstanding request and flips the
-- offer to 'claimed' under the single lock taken on the parent offer.
CREATE OR REPLACE FUNCTION public.respond_to_offer_claim_transaction(
  p_actor_id uuid,
  p_claim_id uuid,
  p_decision text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claim public.offer_claims%ROWTYPE;
  v_offer public.donor_offers%ROWTYPE;
  v_offer_id uuid;
  v_now timestamptz := clock_timestamp();
  v_declined integer := 0;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'invalid claim decision' USING ERRCODE = '22023';
  END IF;

  SELECT c.offer_id INTO v_offer_id FROM public.offer_claims c WHERE c.id = p_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_offer FROM public.donor_offers WHERE id = v_offer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_offer.user_id <> p_actor_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT c.* INTO v_claim FROM public.offer_claims c WHERE c.id = p_claim_id FOR UPDATE;
  IF v_claim.status <> 'requested' THEN
    RAISE EXCEPTION 'claim has already been answered' USING ERRCODE = '23514';
  END IF;

  IF p_decision = 'declined' THEN
    UPDATE public.offer_claims
    SET status = 'declined', responded_at = v_now
    WHERE id = p_claim_id
    RETURNING * INTO v_claim;

    RETURN jsonb_build_object(
      'claim', jsonb_build_object(
        'id', v_claim.id,
        'offer_id', v_claim.offer_id,
        'institution_id', v_claim.institution_id,
        'status', v_claim.status,
        'responded_at', v_claim.responded_at
      ),
      'offer', public.donor_offer_author_dto(v_offer),
      'declined_others', 0
    );
  END IF;

  IF v_offer.status <> 'open' THEN
    RAISE EXCEPTION 'offer is no longer open' USING ERRCODE = '23514';
  END IF;

  WITH others AS (
    UPDATE public.offer_claims
    SET status = 'declined', responded_at = v_now
    WHERE offer_id = v_offer_id AND status = 'requested' AND id <> p_claim_id
    RETURNING id
  )
  SELECT count(*)::integer INTO v_declined FROM others;

  UPDATE public.offer_claims
  SET status = 'accepted', responded_at = v_now
  WHERE id = p_claim_id
  RETURNING * INTO v_claim;

  UPDATE public.donor_offers
  SET status = 'claimed',
      claimed_institution_id = v_claim.institution_id,
      updated_at = v_now
  WHERE id = v_offer_id
  RETURNING * INTO v_offer;

  RETURN jsonb_build_object(
    'claim', jsonb_build_object(
      'id', v_claim.id,
      'offer_id', v_claim.offer_id,
      'institution_id', v_claim.institution_id,
      'status', v_claim.status,
      'responded_at', v_claim.responded_at
    ),
    'offer', public.donor_offer_author_dto(v_offer),
    'declined_others', v_declined
  );
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_offer_claim_transaction(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_offer_claim_transaction(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Bounded reads. Every one of these takes an explicit limit/offset, checks
--    authorization from `p_actor_id`, and releases contact details only for a
--    claim the author has accepted.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_open_donor_offers(
  p_actor_id uuid,
  p_donation_type text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_institution_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 60));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 5000));
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_items jsonb;
  v_total integer;
BEGIN
  v_institution_id := public.verified_offer_institution_for_actor(p_actor_id);

  IF v_query IS NOT NULL AND char_length(v_query) > 80 THEN
    RAISE EXCEPTION 'query too long' USING ERRCODE = '22023';
  END IF;
  IF v_city IS NOT NULL AND char_length(v_city) > 120 THEN
    RAISE EXCEPTION 'city too long' USING ERRCODE = '22023';
  END IF;
  IF p_donation_type IS NOT NULL AND p_donation_type NOT IN (
    'clothes', 'food', 'hygiene', 'toys_books', 'school_supplies', 'furniture',
    'medical_supplies', 'baby_items', 'blankets_bedding', 'money', 'time'
  ) THEN
    RAISE EXCEPTION 'invalid donation type' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer INTO v_total
  FROM public.donor_offers o
  WHERE o.status = 'open'
    AND o.user_id <> p_actor_id
    AND (o.available_until IS NULL OR o.available_until >= current_date)
    AND (p_donation_type IS NULL OR o.donation_type = p_donation_type)
    AND (v_city IS NULL OR lower(o.city) = lower(v_city))
    AND (
      v_query IS NULL
      OR o.title ILIKE '%' || replace(replace(v_query, '%', ''), '_', '') || '%'
    );

  SELECT coalesce(jsonb_agg(item ORDER BY sort_created DESC, sort_id), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      o.created_at AS sort_created,
      o.id AS sort_id,
      public.donor_offer_public_dto(o) || jsonb_build_object(
        'claimed_by_us', EXISTS (
          SELECT 1 FROM public.offer_claims c
          WHERE c.offer_id = o.id
            AND c.institution_id = v_institution_id
            AND c.status IN ('requested', 'accepted')
        )
      ) AS item
    FROM public.donor_offers o
    WHERE o.status = 'open'
      AND o.user_id <> p_actor_id
      AND (o.available_until IS NULL OR o.available_until >= current_date)
      AND (p_donation_type IS NULL OR o.donation_type = p_donation_type)
      AND (v_city IS NULL OR lower(o.city) = lower(v_city))
      AND (
        v_query IS NULL
        OR o.title ILIKE '%' || replace(replace(v_query, '%', ''), '_', '') || '%'
      )
    ORDER BY o.created_at DESC, o.id
    LIMIT v_limit OFFSET v_offset
  ) page;

  RETURN jsonb_build_object(
    'items', v_items,
    'meta', jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_open_donor_offers(uuid, text, text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_open_donor_offers(uuid, text, text, text, integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.list_own_donor_offers(
  p_actor_id uuid,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 60));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 5000));
  v_items jsonb;
  v_total integer;
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO v_total
  FROM public.donor_offers WHERE user_id = p_actor_id;

  SELECT coalesce(jsonb_agg(item ORDER BY sort_created DESC, sort_id), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      o.id AS sort_id,
      o.created_at AS sort_created,
      public.donor_offer_author_dto(o) || jsonb_build_object(
        'claims',
        coalesce((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', c.id,
              'institution_id', c.institution_id,
              'institution_name', i.name,
              'institution_city', i.city,
              'status', c.status,
              'message', c.message,
              'created_at', c.created_at,
              'responded_at', c.responded_at,
              -- Contact is released only once this author has accepted.
              'contact', CASE WHEN c.status = 'accepted' THEN jsonb_build_object(
                'email', i.email, 'phone', i.phone, 'website', i.website
              ) ELSE NULL END
            ) ORDER BY c.created_at DESC, c.id
          )
          FROM public.offer_claims c
          JOIN public.institutions i ON i.id = c.institution_id
          WHERE c.offer_id = o.id
        ), '[]'::jsonb)
      ) AS item
    FROM public.donor_offers o
    WHERE o.user_id = p_actor_id
    ORDER BY o.created_at DESC, o.id
    LIMIT v_limit OFFSET v_offset
  ) page;

  RETURN jsonb_build_object(
    'items', v_items,
    'meta', jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_own_donor_offers(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_own_donor_offers(uuid, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.list_institution_offer_claims(
  p_actor_id uuid,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_institution_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 60));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 5000));
  v_items jsonb;
  v_total integer;
BEGIN
  v_institution_id := public.verified_offer_institution_for_actor(p_actor_id);

  SELECT count(*)::integer INTO v_total
  FROM public.offer_claims WHERE institution_id = v_institution_id;

  SELECT coalesce(jsonb_agg(item ORDER BY sort_created DESC, sort_id), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      c.id AS sort_id,
      c.created_at AS sort_created,
      jsonb_build_object(
        'id', c.id,
        'status', c.status,
        'message', c.message,
        'created_at', c.created_at,
        'responded_at', c.responded_at,
        'offer', public.donor_offer_public_dto(o),
        -- The author's identity and contact appear only after acceptance.
        'donor', CASE WHEN c.status = 'accepted' THEN jsonb_build_object(
          'name', pr.name,
          'email', pr.email,
          'contact_person', pr.contact_person
        ) ELSE NULL END
      ) AS item
    FROM public.offer_claims c
    JOIN public.donor_offers o ON o.id = c.offer_id
    JOIN public.profiles pr ON pr.id = o.user_id
    WHERE c.institution_id = v_institution_id
    ORDER BY c.created_at DESC, c.id
    LIMIT v_limit OFFSET v_offset
  ) page;

  RETURN jsonb_build_object(
    'items', v_items,
    'meta', jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_institution_offer_claims(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_institution_offer_claims(uuid, integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 10. Bounded expiry sweep. Reads already hide a lapsed offer, so this only
--     settles the stored status; it is safe to run repeatedly and never scans
--     more than `p_limit` rows.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.expire_due_donor_offers_batch(
  p_limit integer DEFAULT 250
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 250), 1000));
  v_now timestamptz := clock_timestamp();
  v_expired integer := 0;
BEGIN
  WITH due AS (
    SELECT o.id
    FROM public.donor_offers o
    WHERE o.status = 'open'
      AND o.available_until IS NOT NULL
      AND o.available_until < current_date
    ORDER BY o.available_until, o.id
    LIMIT v_limit
    FOR UPDATE OF o SKIP LOCKED
  ), released AS (
    UPDATE public.offer_claims c
    SET status = 'declined', responded_at = v_now
    FROM due d
    WHERE c.offer_id = d.id AND c.status = 'requested'
    RETURNING c.id
  ), closed AS (
    UPDATE public.donor_offers o
    SET status = 'expired', updated_at = v_now
    FROM due d
    WHERE o.id = d.id
    RETURNING o.id
  )
  SELECT count(*)::integer INTO v_expired FROM closed;

  RETURN jsonb_build_object('expired', v_expired);
END;
$$;

REVOKE ALL ON FUNCTION public.expire_due_donor_offers_batch(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_due_donor_offers_batch(integer) TO service_role;

COMMIT;
