-- ---------------------------------------------------------------------------
-- 013: NGO national registry import (RegistarUdruga 2026).
-- ---------------------------------------------------------------------------
-- Adds:
--   * public.ngo_registry        — raw mirror of RegistarUdruga.csv keyed on
--                                  OIB, plus geocoded coords + category mapping
--   * public.import_state        — resumable cursor for long-running scripts
--   * public.institutions extras — source / registry_oib link + relaxed
--                                  served_population to allow registry rows
-- Plus new social-impact categories (mental_health, refugee_migrant_support,
-- medical_patient_support).
--
-- Additive and idempotent. Curated rows (source='curated') are never touched
-- by the registry promoter — see scripts/promote-registry.mjs.

-- ---------------------------------------------------------------------------
-- 1. Institutions: provenance + registry link.
-- ---------------------------------------------------------------------------

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'curated'
    CHECK (source IN ('curated', 'registry', 'user_claimed'));

ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS registry_oib text;

-- Backfill: every row that exists today is curated.
UPDATE public.institutions SET source = 'curated' WHERE source IS NULL;

-- Allow registry rows that haven't yet attached a target population.
ALTER TABLE public.institutions
  ALTER COLUMN served_population DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_institutions_source ON public.institutions(source);
CREATE INDEX IF NOT EXISTS idx_institutions_registry_oib
  ON public.institutions(registry_oib)
  WHERE registry_oib IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. ngo_registry: raw import.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ngo_registry (
  oib                          text PRIMARY KEY,
  -- raw CSV columns
  mail                         text,
  naziv                        text NOT NULL,
  status                       text NOT NULL,
  udr_id                       text,
  ciljevi                      text,
  sjediste                     text,
  zupanija                     text,
  datum_upisa                  date,
  web_stranica                 text,
  datum_statusa                date,
  skraceni_naziv               text,
  ciljane_skupine              text,
  opis_djelatnosti             text,
  registarski_broj             text,
  oblik_udruzivanja            text,
  gospodarske_djelatnosti      text,
  naziv_na_drugim_jezicima     text,
  datum_osnivacke_skupstine    date,
  skr_naziv_na_drugim_jezicima text,

  -- derived address parts (best-effort parse of sjediste)
  street                       text,
  city                         text,

  -- geocoder output
  lat                          double precision,
  lng                          double precision,
  geocode_source               text,
  geocode_confidence           text
    CHECK (geocode_confidence IN ('exact','street','city','county') OR geocode_confidence IS NULL),
  geocoded_at                  timestamptz,

  -- category mapping output
  mapped_category              text,
  mapped_confidence            numeric(4,3),
  mapped_rule                  text,

  -- promotion link back into institutions
  institution_id               uuid REFERENCES public.institutions(id) ON DELETE SET NULL,

  -- provenance
  imported_at                  timestamptz NOT NULL DEFAULT now(),
  import_batch_id              text,
  raw_row_jsonb                jsonb
);

CREATE INDEX IF NOT EXISTS idx_ngo_registry_status            ON public.ngo_registry(status);
CREATE INDEX IF NOT EXISTS idx_ngo_registry_zupanija          ON public.ngo_registry(zupanija);
CREATE INDEX IF NOT EXISTS idx_ngo_registry_city              ON public.ngo_registry(city);
CREATE INDEX IF NOT EXISTS idx_ngo_registry_mapped_category   ON public.ngo_registry(mapped_category);
CREATE INDEX IF NOT EXISTS idx_ngo_registry_oblik             ON public.ngo_registry(oblik_udruzivanja);
CREATE INDEX IF NOT EXISTS idx_ngo_registry_institution       ON public.ngo_registry(institution_id) WHERE institution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ngo_registry_promotable
  ON public.ngo_registry(status, mapped_confidence, geocode_confidence)
  WHERE status = 'AKTIVAN';

-- pg_trgm for FT search on name + sjediste.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_ngo_registry_name_trgm     ON public.ngo_registry USING gin (naziv gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ngo_registry_sjediste_trgm ON public.ngo_registry USING gin (sjediste gin_trgm_ops);

ALTER TABLE public.ngo_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Registry is publicly readable" ON public.ngo_registry;
CREATE POLICY "Registry is publicly readable"
  ON public.ngo_registry
  FOR SELECT
  USING (true);

-- All writes are service-role only (importer / promoter scripts).
-- No INSERT/UPDATE/DELETE policies → blocked for anon and authenticated.

-- ---------------------------------------------------------------------------
-- 3. import_state: resumable cursor for long-running scripts.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.import_state (
  job_name        text PRIMARY KEY,
  cursor          text,
  rows_processed  integer NOT NULL DEFAULT 0,
  last_run_at     timestamptz NOT NULL DEFAULT now(),
  notes           text
);

ALTER TABLE public.import_state ENABLE ROW LEVEL SECURITY;
-- service-role only (no policies).

-- ---------------------------------------------------------------------------
-- 4. updated_at trigger for institutions still applies to source-bumped rows.
-- ---------------------------------------------------------------------------
-- (no schema change needed; existing trigger covers it.)
