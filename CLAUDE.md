# DajSrce agent playbook

**Synced:** 2026-08-04. Read `TECHNICAL_IMPLEMENTATION.md` and `REMEDIATION_IMPLEMENTATION_STATUS.md` before changing a domain. The detailed original findings and acceptance targets are in `PROJECT_WIDE_AUDIT_AND_OPTIMIZATION_PLAN.md`.

## Product snapshot

DajSrce is a nationwide Croatian donation, volunteering and company-impact platform. The production branch is `main`; Vercel deploys it. Stack: Next.js 15.5, React 19, strict TypeScript, Tailwind 4, Supabase/Postgres/PostGIS/Storage, Leaflet, Stripe, Resend and SudReg.

Core domains:

- public institution discovery through viewport-bounded map/detail APIs, served at `/`;
- one merged `/organisations` surface with four views (active, register, needs, help); `/needs` and `/quick-start` redirect into it;
- citizen donation offers that verified organisations claim;
- NGO needs, acknowledgement-backed pledges and opted-in nearby notifications;
- volunteer events, capacity-safe signup, hashed QR check-in and idempotent checkout hours;
- company tenants, members, campaigns, authoritative verification and subscriptions;
- receipts, ESG exports, CSR PDF/DOCX and acknowledgement-backed public impact;
- staged/resumable registry import, durable geocoding, reviewed classification and transactional promotion.

## Non-negotiable invariants

1. `/api/institutions` stays retired. Never return the national catalogue or exact hidden coordinates to the browser.
2. Public map results come from `map_institutions_v1`; detail comes from `public_institution_detail_v1`. Keep viewport/zoom/query/limit guards and explicit truncation.
3. Do not derive roles or entitlements from user metadata, request bodies, Stripe client metadata or public feature flags.
4. Multi-row pledge, volunteer, company, audit, billing and artifact transitions belong in service-only transactional RPCs.
5. Raw invite/verification/check-in tokens are never persisted. Store SHA-256 digests, bind identity/control, expire and consume once.
6. Only acknowledgement-backed donations are confirmed evidence. “Delivered” alone is not confirmed public impact.
7. Artifact versions are reserved atomically; only `generation_status = 'ready'` is downloadable/public. Clean partial storage on failure.
8. Registry classification and donation candidates are not organizational confirmation. Curated rows win; excluded entity shapes require review.
9. Nearby notification requires explicit opt-in and runs through the durable outbox/POST worker, not request-time profile scans.
10. Production fails closed. Local fixtures and demo billing are development-only and explicit.
11. Security-definer functions use `pg_catalog` first, schema-qualified relations, explicit revoke/grant and the narrowest caller roles.
12. Keep secrets, raw tokens and protected coordinates out of logs/client code. Use request IDs and structured event logs.
13. An NGO account is a reviewed claim against an official `UDR_ID`, never a typed name. Nothing creates an institution from user input, and no institution is ever given a fabricated coordinate. Until a claim is approved an `ngo` profile has a null `institution_id` and cannot publish or receive.
14. Donor offers store a coarse point and a city only — never a private individual's exact location — and contact details are released only after the author accepts a claim.
15. Passwords are bcrypt-hashed by Supabase Auth and never seen by this application. Never encrypt a password. Strength rules apply to sign-up and password change only, never to sign-in.

## Current public performance contract

- <= 200 map features per response; HTTP default 150.
- <= 60 result rows in the DOM.
- the map is the home page (`/`); `/map` is a permanent redirect. The browser URL carries a compact `@lat,lng,zoom` and only non-default state, and nothing is fetched until Leaflet reports its first bounds.
- `map_association_registry_v*` clusters when matches exceed the feature budget, on a grid capped at 6x6. Detail is lazy-loaded.
- pin fill encodes registry / onboarded / verified, not category; category moves to a disc inside the pin.
- AbortController plus stale-sequence protection on viewport changes.
- ETag and CDN cache for public map/card responses.
- `npm run perf:map:bundle` now weighs the chunks **exclusive** to the map route plus its dynamic imports (238,251 bytes against a 327,680 budget). It used to subtract only what the `/page` redirect loaded, so figures recorded before the map moved to `/` are not comparable. The script fails loudly if it measures nothing.
- hidden locations use stable coarse `public_location`; filtering also uses that projection.

Do not reintroduce root cookie access, global middleware matching, remote Google fonts, global Leaflet CSS, wildcard Lucide imports, automatic geolocation or global notification polling.

## New migration order

1. `20260801010000_profiles_locale_default_en.sql`
2. `202608010300_transactional_integrity.sql`
3. `20260801150000_location_fast_path.sql`
4. `20260801160000_security_release_gate.sql`
5. `20260801170000_registry_pipeline.sql`
6. `20260801180000_async_notifications_public_metrics.sql`
7. `20260804190000_official_association_directory.sql`
8. `20260804200000_registry_snapshot_reconciliation.sql`
9. `20260804203000_atomic_registry_snapshot_visibility.sql`
10. `20260804210000_registry_snapshot_memberships.sql`
11. `20260804213000_constant_time_registry_finalize.sql`
12. `20260804220000_registry_directory_projection.sql`
13. `20260804223000_registry_compatibility_reconciliation.sql`
14. `20260804230000_registry_storage_lifecycle.sql`
15. `20260804233000_registry_count_fast_path.sql`
16. `20260805010000_active_registry_scope.sql`
17. `20260805160000_active_registry_map.sql`
18. `20260805180000_dgu_exact_address_geocoding.sql`
19. `20260812100000_map_coarse_clusters_city_directory.sql`
20. `20260812110000_cancel_pledges_and_signups.sql`
21. `20260812120000_institution_claims.sql`
22. `20260812130000_donor_offers.sql`
23. `20260812140000_engaged_association_directory.sql`

Never reuse a migration version. Add a new sortable timestamp migration for follow-up database work. The application and these migrations must be staged together; new application code intentionally fails closed on an old schema.

## Environment and operations

Required in production: Supabase URL/anon/service keys, HTTPS app URL and a 32+ character `CRON_SECRET`. Configure a POST-capable scheduler for:

- `POST /api/cron/auto-acknowledge`
- `POST /api/cron/process-notification-jobs`

Both use `Authorization: Bearer <CRON_SECRET>`. Vercel's GET-only cron stays disabled. `ALLOW_DEMO_BILLING` and `ALLOW_LOCAL_FIXTURES` must be false/unset in production.

Before release, restore a production backup into staging, apply migrations, exercise RLS/RPC flows, run the full check/build/audit and monitor failed Stripe events, dead notification jobs and failed artifacts. See the complete runbook in `TECHNICAL_IMPLEMENTATION.md`.

## Repository workflow

- Preserve unrelated/untracked user files.
- Use explicit DTO column lists and validation limits; do not use broad public selects.
- Keep routes small: authenticate, validate, authorize, call a domain helper/RPC, map a stable error.
- Use `npm.cmd` in Windows PowerShell where execution policy blocks `npm.ps1`.
- Required gate: `npm run check`, `npm audit`, `npm run build`, `git diff --check`.
- CI runs on pushes to `main` and pull requests; Dependabot is configured.

## Renderer rule

Receipt and CSR PDFs use complete static Noto Sans TTFs from `@expo-google-fonts/noto-sans` with fontkit subsetting disabled. WOFF subset files and fontkit's TTF subset path produced invalid/missing glyphs in PDF readers. Any renderer change must generate a long Croatian sample, visually inspect every PDF/DOCX page and verify source/summary reconciliation.

## Registry commands

- `npm run registry:sync -- --dry-run`
- `npm run registry:sync -- --batch-size 500` (the importer automatically bisects timed-out ranges)
- `npm run registry:import -- --csv <path>`
- `npm run registry:verify`
- `npm run registry:maintain`
- `npm run registry:remap`
- `npm run registry:geocode`
- `npm run registry:promote -- --dry-run`

`registry:sync` must mirror every `AKTIVAN` row in the CTS snapshot and purge canonical rows outside that active snapshot. Production imports require `--active-only`; `--limit` and `--zg` remain dry-run-only. `UDR_ID` is the official canonical key and OIB is optional source data, so optional-field warnings do not remove an otherwise valid active organisation. Publication is one pointer update over immutable batch membership/directory rows; the legacy `source_present` flag is reconciled and inactive canonical rows are deleted afterward in timeout-safe batches. Configure GitHub Actions secrets `PRODUCTION_SUPABASE_URL` and `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY` for scheduled sync. The workflow runs `registry:verify` after every publication. Use dry-run/coverage before promotion. Nominatim requires a real identifying user agent/contact and <= 1 request/second. Never infer public donation acceptance from category defaults.
