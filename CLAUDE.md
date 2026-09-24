# DajSrce agent playbook

**Synced:** 2026-08-04. Read `TECHNICAL_IMPLEMENTATION.md` and `REMEDIATION_IMPLEMENTATION_STATUS.md` before changing a domain. The detailed original findings and acceptance targets are in `PROJECT_WIDE_AUDIT_AND_OPTIMIZATION_PLAN.md`.

## Product snapshot

DajSrce is a nationwide Croatian donation and volunteering platform. The production branch is `main`; Vercel deploys it. Stack: Next.js 15.5, React 19, strict TypeScript, Tailwind 4, Neon Postgres/PostGIS (via the Neon Data API), Supabase Auth, Leaflet and Resend.

## Database: Neon, identity: Supabase Auth

Postgres moved from Supabase to Neon (project `broad-term-74317717`, branch `production`, eu-central-1) on 2026-09-23; Supabase now provides **Auth only**. The app keeps supabase-js for its query builder, but every client factory (`src/lib/supabase/{server,public,client,admin}.ts`, `src/middleware.ts`, `scripts/lib/supabase-admin.mjs`) passes a `global.fetch` from `src/lib/data-api/fetch.ts` that rewrites `/rest/v1` onto `NEXT_PUBLIC_DATA_API_URL` and leaves `/auth/v1` on Supabase. Call sites do not change.

- Neon verifies ES256 tokens the app signs with `DATA_API_JWT_PRIVATE_JWK` (server-only) against `public/.well-known/jwks.json` (audience `dajsrce-data-api`). `role` picks one of `anon`, `authenticated` (with `sub` = Supabase user id, so `auth.uid()` and all RLS work unchanged; pg_session_jwt provides it) or `service_role` (BYPASSRLS, server/scripts only). `authenticator` is a member of no other role. Rotate the key pair together.
- A user token is minted only after the Supabase JWT verifies (`getVerifiedClaims` server-side; `auth.getUser()` in `/api/auth/data-token`, the browser's only way to get one). Never mint from request input.
- `auth.users` stayed in Supabase: `profiles_id_fkey` and the `on_auth_user_created` trigger are gone. `ensure_own_profile()` (called once per process per user from `src/lib/data-api/session.ts`) does the same least-privileged insert.
- Neon has no Realtime. Capacity counters poll `/api/capacity` (CDN-cached 15 s) and the bell polls `/api/notifications` every 60 s, both only while the tab is visible, plus an immediate re-read on return. This is the deliberate replacement for Realtime; do not widen it.
- Direct SQL (migrations, maintenance) uses `DATABASE_URL_UNPOOLED` as `neondb_owner`. The app itself never opens a Postgres connection.
- Production (dajsrce.hr) cut over to Neon on 2026-09-23 (`74a2408`, fixed in `feb0bc2`). The old Supabase database is no longer read or written by the app; `createDataApiFetch` throws rather than send a `/rest/v1` request to it. Do not point anything back at it.
- The Data API verifies against `https://raw.githubusercontent.com/id55854/dajsrce/main/public/.well-known/jwks.json` (the same file the app serves at `/.well-known/jwks.json`). Changing the JWKS URL means `neon data-api delete` + `create` (a brief Data API outage) followed by `grant anon, service_role to authenticator`.
- The scheduled registry sync is paused (`registry-sync.yml` keeps `workflow_dispatch` only).

Core domains:

- public institution discovery through viewport-bounded map/detail APIs, served at `/`;
- `/organisations` is the official register only; an unknown `?view=` is redirected, never silently ignored;
- one merged `/doniraj` surface for giving, with a needs view and a donation wizard; `/needs` and `/quick-start` redirect into it;
- NGO needs, pledges and opted-in nearby notifications;
- volunteer events and capacity-safe, one-click signup;
- staged/resumable registry import, durable geocoding, reviewed classification and transactional promotion.

Only two account types exist: `individual` and `ngo` (plus `superadmin`). The company/CSR tenant domain (company accounts, campaigns, Stripe billing, tax receipts, ESG exports, CSR PDF/DOCX reports) was removed in `20260823100000_remove_company_domain.sql`; do not reintroduce a `company` role or resurrect Stripe without a fresh product decision.

The citizen donor-offer flow (`/offers`, `/offers/inbox`, the `/api/offers` routes, `OfferCard`, `src/lib/offers.ts`) was removed from the application on 2026-08-24; the "I can donate" entry point on `/doniraj` is gone with it. The underlying `donor_offers`/`offer_claims` schema from `20260812130000_donor_offers.sql` was deliberately left in place, dormant; no migration dropped it, so those tables/RPCs still exist unused in the database. `20260924210100_revoke_dormant_donor_offer_access.sql` removes the authenticated PostgREST grants and policies; `service_role` still owns the functions. That migration is in the repo and has not been applied to Neon. Do not reintroduce the `/offers` UI or API without a fresh product decision; if the schema itself is ever dropped, do that in its own new migration, not by editing the original one.

The pledge and volunteer-signup status machinery was removed from the application on 2026-09-21: pledge statuses (`pledged`/`delivered`/`confirmed`), acknowledgements, the donor's "mark delivered" action, volunteer check-in/check-out, the hashed QR self-check-in flow and the `auto-acknowledge` cron are all gone from the UI, the API routes and the scheduler. A pledge is a promise and a signup is a signup; the only action left on either is the person withdrawing their own. The database keeps `pledges.status`, `pledge_acknowledgements`, `volunteer_signups.checked_in_at`/`checked_out_at`, `volunteer_hours` and the matching RPCs, dormant and unread except that a withdrawn row is still soft-cancelled and filtered out of every list; no migration dropped them. Do not rebuild any of it without a fresh product decision, and if the schema is ever dropped, do that in its own new migration.

## Non-negotiable invariants

1. `/api/institutions` stays retired. Never return the national catalogue or exact hidden coordinates to the browser.
2. Public map results come from `map_institutions_v1`; detail comes from `public_institution_detail_v1`. Keep viewport/zoom/query/limit guards and explicit truncation.
3. Do not derive roles or entitlements from user metadata, request bodies or public feature flags.
4. Multi-row pledge, volunteer, audit and artifact transitions belong in service-only transactional RPCs.
5. Raw invite/verification tokens are never persisted. Store SHA-256 digests, bind identity/control, expire and consume once.
6. A pledge and a volunteer signup carry no status a person has to follow. Either stands or is withdrawn by the person who made it; nothing is approved, rejected, checked in or acknowledged. See the removal note below before rebuilding any of that.
7. Artifact versions are reserved atomically; only `generation_status = 'ready'` is downloadable/public. Clean partial storage on failure.
8. Registry classification and donation candidates are not organizational confirmation. Curated rows win; excluded entity shapes require review.
9. Nearby notification requires explicit opt-in and runs through the durable outbox/POST worker, not request-time profile scans.
10. Production fails closed. Local fixtures are development-only and explicit.
11. Security-definer functions use `pg_catalog` first, schema-qualified relations, explicit revoke/grant and the narrowest caller roles.
12. Keep secrets, raw tokens and protected coordinates out of logs/client code. Use request IDs and structured event logs.
13. An NGO account is a reviewed claim against an official `UDR_ID`, never a typed name. Nothing creates an institution from user input, and no institution is ever given a fabricated coordinate. Until a claim is approved an `ngo` profile has a null `institution_id` and cannot publish or receive.
14. (Dormant, kept for history) The removed donor-offers schema stored a coarse point and a city only, never a private individual's exact location, and released contact details only after the author accepted a claim. Any revival of that flow must keep the same rule.
15. Passwords are bcrypt-hashed by Supabase Auth and never seen by this application. Never encrypt a password. Strength rules apply to sign-up and password change only, never to sign-in.

## Current public performance contract

- <= 200 map features per response; HTTP default 150.
- <= 60 result rows in the DOM.
- the map is the home page (`/`); `/map` is a permanent redirect. The browser URL carries a compact `@lat,lng,zoom` and only non-default state, and the server supplies a bounded public snapshot in HTML (five-minute data cache). Client refresh waits for Leaflet to report its actual bounds.
- `map_association_registry_v*` clusters when matches exceed the feature budget, on a grid capped at 6x6. Detail is lazy-loaded.
- pin fill encodes registry / onboarded / verified, not category; category moves to a disc inside the pin.
- the donation-type filter is multi-select and means "accepts any of these". The RPC takes both the original scalar `p_donation_type` and the newer `p_donation_types` array and unions them, so a single-type filter still resolves against a schema that predates `20260922120000`; two or more types need that migration and otherwise degrade to the bounded fallback.
- AbortController plus stale-sequence protection on viewport changes.
- ETag and CDN cache for public map/card responses. The map and city ETags are derived from the canonical query plus the current `s-maxage` window (`W/"..."`), so a matching `If-None-Match` is a 304 before any RPC.
- the client snaps the requested bbox outward to a quarter-tile grid per zoom (`normalizeBboxForRequest`) and shrinks about the centre when the per-zoom area guard would reject it; nearby viewports share one CDN key.
- `/api/needs` and `/api/volunteer-events` GET read through the stateless anon client and are CDN-cached (`s-maxage=60`); anything that reads cookies stays `no-store`.
- read-only authenticated paths (middleware, `/api/me`, own-pledge/signup/notification lists) verify the session JWT locally via `getVerifiedClaims` (ES256 + cached JWKS). Every mutation, review and token issuance keeps `auth.getUser()`.
- every API route is rate limited per client address (`src/lib/security/http.ts`); unsafe methods also require same-origin.
- `npm run perf:map:bundle` now weighs the chunks **exclusive** to the map route plus its dynamic imports (243,734 bytes against a 327,680 budget). It used to subtract only what the `/page` redirect loaded, so figures recorded before the map moved to `/` are not comparable. The script fails loudly if it measures nothing.
- hidden locations use stable coarse `public_location`; filtering also uses that projection.

Do not reintroduce root cookie access, global middleware matching, remote Google fonts, global Leaflet CSS, wildcard Lucide imports or automatic geolocation. Notification polling is limited to the visible-tab bell poll described above; do not add others.

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
24. `20260821120000_map_onboarded_filter_and_multiterm_search.sql`
25. `20260821130000_map_onboarded_requires_account.sql`
26. `20260821140000_engaged_directory_requires_account.sql`
27. `20260821150000_register_classified_only_default.sql`
28. `20260822120000_registry_orphan_repair_and_map_fast_path.sql`
29. `20260822140000_map_planar_viewport_predicate.sql`
30. `20260822160000_city_districts_and_place_clustering.sql`
31. `20260822180000_fix_place_cluster_column_ambiguity.sql`
32. `20260822200000_place_cluster_tier_selection.sql`
33. `20260822220000_place_cluster_single_pass_stats.sql`
34. `20260822240000_restore_public_city_directory.sql`
35. `20260823100000_remove_company_domain.sql`
36. `20260824100000_activity_notifications.sql`
37. `20260825120000_fix_map_onboarded_regression.sql`
38. `20260906120000_audit_transaction_coverage.sql` (applied to production by hand on 2026-09-06)
39. `20260922120000_map_multi_donation_types.sql` (map donation-type filter is multi-select; drops and recreates `map_association_registry_v1`/`v2` with a trailing `p_donation_types text[]`)
40. `20260923120000_notifications_realtime.sql` (adds `public.notifications` to the `supabase_realtime` publication; the navbar subscribes per signed-in user instead of polling, and RLS limits each subscriber to their own rows)
41. `20260923130000_capacity_realtime.sql` (adds `public.needs` and `public.volunteer_events` to `supabase_realtime`; `useLiveCapacity` shares one channel per table and reads only the counter columns, while the pledge/signup RPCs still enforce capacity under a row lock)
42. `20260923140000_neon_data_api.sql` (Neon: `anon`/`service_role` roles and their `authenticator` grants, Supabase-style default privileges, drops `profiles_id_fkey`, adds `ensure_own_profile()`). Migrations 40-41 are Supabase-only and are no-ops on Neon; the Neon database was seeded from a `pg_dump` of production, not by replaying this list.
43. `20260923150000_jev_registry_classification.sql` (`apply_registry_classifications` also refreshes the current snapshot's directory category; `merge_registry_import_batch` keeps a Jev classification while the organisation's text is unchanged)
44. `20260924100000_volunteer_event_location.sql` (optional free-text `volunteer_events.location`, 1-300 chars; NULL means "at the organisation's address"; never geocoded, no coordinate). The volunteer event API selects it, so apply before deploying.
45. `20260924110000_delete_needs_and_events.sql` (`delete_need_transaction` / `delete_volunteer_event_transaction`, service_role only: ownership from the actor's `ngo` profile, notifies donors/volunteers with standing pledges/signups before the ON DELETE CASCADE removes them, audits the counts)
46. `20260924120000_rule_promoted_institutions_follow_jev.sql` (institutions the old rule promoter created, `source = 'registry'` with no account, now follow the Jev classification instead of overriding it; only `curated` and claimed institutions keep their own category. Old values in `ops.institutions_category_before_jev`)
47. `20260924130000_curated_institutions_on_map.sql` (`map_association_registry_v1` also returns reviewed curated institutions that no register row links to: `source = 'curated' AND is_verified`, same filters/clustering, hidden locations as their public point only. Typed-name test institutions stay off the map. Adds `idx_registry_directory_entries_batch_city`)
48. `20260924140000_notify_on_cancellation.sql` (`cancel_pledge_transaction` and `cancel_volunteer_signup_transaction` now notify the institution's `ngo` accounts of a withdrawal, as the create transactions already did; bodies otherwise unchanged from `20260906120000`. No application change depends on it.)

Apply new migrations to Neon with `DATABASE_URL_UNPOOLED` (psql or `neon psql`), then `neon data-api refresh-schema --database neondb` so the Data API sees new functions and columns.

Never reuse a migration version. Add a new sortable timestamp migration for follow-up database work. The application and these migrations must be staged together; new application code intentionally fails closed on an old schema.

## Environment and operations

Required in production: Supabase URL/anon key (Auth), `NEXT_PUBLIC_DATA_API_URL`, `DATA_API_JWT_PRIVATE_JWK`, HTTPS app URL and a 32+ character `CRON_SECRET`. The map basemap needs `NEXT_PUBLIC_CARTO_API_KEY` (CARTO Basemaps key from carto.com/basemaps/apikey; CARTO watermarks key-less raster tiles). Without it `src/lib/basemap.ts` falls back to OpenStreetMap raster tiles, which is fine for a clone or a short outage but not the intended production basemap. Configure a POST-capable scheduler for:

- `POST /api/cron/process-notification-jobs`
- `POST /api/cron/event-reminders` (once a day: reminds volunteers signed up for tomorrow's event)

Both use `Authorization: Bearer <CRON_SECRET>`. `.github/workflows/notification-cron.yml` schedules both via GitHub Actions (`process-notification-jobs` every 15 min, the reminders daily); it needs repo secrets `PRODUCTION_APP_URL` and `CRON_SECRET` alongside `PRODUCTION_DATA_API_URL` and `PRODUCTION_DATA_API_JWT_PRIVATE_JWK` (used by `registry-sync.yml`). Vercel's GET-only cron stays disabled. `ALLOW_LOCAL_FIXTURES` must be false/unset in production.

Institution-claim review needs `DATA_API_JWT_PRIVATE_JWK` (service-role Data API token); the mailbox challenge additionally needs `RESEND_API_KEY` and `RESEND_FROM_EMAIL`. A delivery failure is logged and never counts as verification.

`docs/SUPABASE_OPERATIONS_CHECKLIST.md` lists the dashboard-side work (auth settings, MFA, backups, monitoring, buckets, RLS) with what was verified live on 2026-09-06. Two Supabase Auth settings are still unset and cannot be fixed in code; the client rules they mirror are bypassable by calling the Auth API directly. See `docs/AUTH_PASSWORD_OPERATIONS.md` for the exact paths and the release checklist: minimum password length raised to 12, and Leaked Password Protection enabled. MFA is documented there as a prerequisite toggle plus unbuilt enrolment/`aal2` work; do not record it as done.

Before release, restore a production backup into staging, apply migrations, exercise RLS/RPC flows, run the full check/build/audit and monitor dead notification jobs and failed artifacts. See the complete runbook in `TECHNICAL_IMPLEMENTATION.md`.

## Repository workflow

- Preserve unrelated/untracked user files.
- Use explicit DTO column lists and validation limits; do not use broad public selects.
- Keep routes small: authenticate, validate, authorize, call a domain helper/RPC, map a stable error.
- Use `npm.cmd` in Windows PowerShell where execution policy blocks `npm.ps1`.
- Required gate: `npm run check`, `npm audit`, `npm run build`, `git diff --check`.
- CI runs on pushes to `main` and pull requests; Dependabot is configured.

## Registry commands

- `npm run registry:sync -- --dry-run`
- `npm run registry:sync -- --batch-size 500` (the importer automatically bisects timed-out ranges)
- `npm run registry:import -- --csv <path>`
- `npm run registry:verify`
- `npm run registry:maintain`
- `npm run registry:reclaim` (`--dry-run`, `--full`)
- `npm run registry:districts` (`--dry-run`)
- `npm run registry:classify` (Jev; `--eval`, `--dry-run`, `--limit`, `--all`). Needs `TYPESAFE_API_KEY`.
- `npm run registry:geocode`
- `npm run registry:promote -- --dry-run`

Post-sync maintenance is not optional and must run after a **failed** sync too. The importer stages and projects as it goes, so a run that dies before finalization leaves a full partial projection behind; `cleanup_registry_snapshot_storage_batch` is the only thing that reclaims it. Deleting those rows does not shrink the files; follow up with `registry:reclaim` when the plan's storage ceiling is in sight.

`registry:sync` must mirror every `AKTIVAN` row in the CTS snapshot and purge canonical rows outside that active snapshot. Production imports require `--active-only`; `--limit` and `--zg` remain dry-run-only. `UDR_ID` is the official canonical key and OIB is optional source data, so optional-field warnings do not remove an otherwise valid active organisation. Publication is one pointer update over immutable batch membership/directory rows; the legacy `source_present` flag is reconciled and inactive canonical rows are deleted afterward in timeout-safe batches. Configure GitHub Actions secrets `PRODUCTION_SUPABASE_URL` and `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY` for scheduled sync. The workflow runs `registry:verify` after every publication. Use dry-run/coverage before promotion. Nominatim requires a real identifying user agent/contact and <= 1 request/second. Never infer public donation acceptance from category defaults.

Categories come from TypeSafe's Jev, not the keyword rules (see `docs/REGISTRY_CLASSIFICATION.md`: 95% care precision vs 43% for the rules on a held-out hand-labelled sample). The importer never publishes a rule guess: new or changed rows arrive `unmapped`/`pending:jev` and `registry:classify` (run by `registry-sync.yml` after every sync) classifies them. Change the rubric only with a version bump and a `--eval` run.
