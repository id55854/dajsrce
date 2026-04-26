# CLAUDE.md — DajSrce Agent Playbook

> Shared context for every AI agent on this repo. If you change anything
> meaningful, amend the matching section here in the same commit.

Last synced: 2026-04-27 (restore "/" → "/map" redirect; company verification via SudReg + email; volunteer signup live counter + calendar; Find NGOs reverse-geocode; locale switch via server action; consolidated RLS fix migration 016)

---

## 1. Project snapshot

- **Name:** DajSrce ("Give Heart") — Croatian civic-tech platform connecting
  donors and volunteers with social institutions (shelters, soup kitchens,
  children's homes, Caritas, etc.). Originally Zagreb-only; now nationwide
  via the NGO registry import (~2,500+ institutions).
- **Production:** https://dajsrce.vercel.app (Vercel auto-deploys `main`).
- **Repo:** https://github.com/id55854/dajsrce.git
- **Stack:** TypeScript strict · Next.js 15 App Router · React 19 · Tailwind CSS v4 ·
  Supabase · Leaflet.
- **Locale:** Croatian default (`hr`), English fallback (`en`). Mixed UI is
  acceptable; assume bilingual audience.

### Core user flows

1. Anonymous browse: `/map` (Leaflet), `/needs`, `/volunteer` — no login.
2. Citizens sign up (email/password or Google OAuth), pledge against needs,
   sign up for volunteer events.
3. Institution users post needs and volunteer events from
   `/dashboard/institution`.
4. Proximity notifications: 3 km radius around posting institution; one
   `notifications` row per matching citizen.
5. User coords saved on login via `/api/location` (Navbar prompts geolocation).
6. Floating bottom-left `AccessibilityMenu` exposes 8 WCAG 2.1 AA tools
   persisted in `localStorage`.
7. Croatian companies register as a **Company tenant** (distinct from the
   per-user `company` role): OIB-gated onboarding wizard, employee invites by
   token or verified email domain, giving campaigns, employees can pledge on
   behalf of company with optional match. See §13.
8. In-repo i18n (`src/i18n/`): `locale` cookie read by both server components
   and the `LocaleSwitcher` client component (now via server action).
9. **Phase 1:** Pledges carry optional `amount_eur`. NGOs mark pledges
   **delivered** then **acknowledge** (manual or cron after
   `AUTO_ACKNOWLEDGE_DAYS`). Companies on a paid Stripe tier with
   `NEXT_PUBLIC_FLAG_RECEIPTS_ENABLED` generate **donation receipts** (PDF +
   XML) into Storage and email the owner via Resend.
10. **Phase 2:** Finance users generate **ESG export ZIPs** (framework + period)
    when `NEXT_PUBLIC_FLAG_EXPORTS_ENABLED` and tier allows. NGOs check in/out
    volunteers; check-out writes `volunteer_hours`. Self check-in QR →
    `/volunteer/self-checkin?event=…`.
11. **Phase 3:** SME Plus / Enterprise companies with
    `NEXT_PUBLIC_FLAG_PUBLIC_PROFILE_ENABLED` may publish `/company/[slug]`
    via RPC `get_public_company_bundle` (no leaked OIB/revenue on anonymous
    reads). Finance users generate **CSR reports** (PDF + DOCX → bucket
    `reports`). Embed: `/company/[slug]/embed` · OG: `/api/og/company/[slug]`.
12. **Company verification (§13):** owners/admins verify the company's OIB
    against the Croatian court registry (SudReg) and confirm via email link →
    stamps `companies.verified_at`. UI: Settings → Verification tab.

---

## 2. Tech stack and key dependencies

Pin to these major versions unless asked to upgrade.

| Purpose        | Package                                   | Version  |
|----------------|-------------------------------------------|----------|
| Framework      | `next`                                    | ^15.2.0  |
| UI runtime     | `react`, `react-dom`                      | ^19.0.0  |
| Auth/DB client | `@supabase/ssr`, `@supabase/supabase-js`  | ^0.6/2.49|
| Maps           | `leaflet`, `react-leaflet`, `@types/leaflet` | ^1.9 / ^5.0 |
| Styling        | `tailwindcss` + `@tailwindcss/postcss`    | ^4.0.0   |
| Dates          | `date-fns`                                | ^4.1.0   |
| Icons          | `lucide-react`                            | ^0.474.0 |
| Utilities      | `clsx`                                    | ^2.1.1   |
| PDF receipts   | `pdf-lib`                                 | ^1.17.x  |
| Payments       | `stripe`                                  | ^22.x    |
| Email          | `resend`                                  | ^6.x     |
| ZIP exports    | `jszip`                                   | ^3.x     |
| CSR DOCX       | `docx`                                    | ^9.x     |
| QR (volunteer) | `qrcode`                                  | ^1.x     |
| DB tooling     | `pg` (scripts only)                       | ^8.20.0  |

Build: Turbopack in dev (`next dev --turbopack`); TS `strict: true`, alias
`@/* → src/*`; Tailwind v4 via `postcss.config.mjs` + `@import "tailwindcss"`
in `src/app/globals.css`.

---

## 3. Directory layout

```
dajsrce/
├── src/
│   ├── middleware.ts              # Supabase SSR session refresh on every request
│   ├── app/
│   │   ├── layout.tsx             # Root HTML, theme bootstrap, AccessibilityMenu, LocaleProvider
│   │   ├── page.tsx               # "/" -> "/map" (server redirect)
│   │   ├── hub/page.tsx           # Legacy 4-card hub UI (Map/Needs/Volunteer/Dashboard); not in navbar
│   │   ├── globals.css            # Tailwind entry + dark mode + a11y overrides
│   │   ├── actions/locale.ts      # Server action: setLocaleAction (cookies + revalidatePath)
│   │   ├── map/                   # Interactive Leaflet map + list view
│   │   ├── needs/                 # Public Needs board
│   │   ├── volunteer/             # Public events listing + month calendar header
│   │   ├── quick-start/           # "Find NGOs" wizard (formerly Quick Start)
│   │   ├── institution/[id]/      # Public institution detail
│   │   ├── verify-company/        # Lands company-verification email link
│   │   ├── company/
│   │   │   ├── [slug]/                # Phase 3 public impact profile (gated)
│   │   │   │   └── embed/route.ts     # Embeddable metrics card script
│   │   │   └── confirmations/[slug]/  # Printable corporate support confirmation (v2)
│   │   ├── dashboard/
│   │   │   ├── page.tsx           # Role-gated router
│   │   │   ├── individual/        # Pledges, badges
│   │   │   ├── ngo/               # Alias to /institution
│   │   │   ├── institution/       # Create needs/events; /pledges sub for delivered+ack; /volunteers roster
│   │   │   ├── admin/             # Superadmin
│   │   │   └── company/           # Tenant home, /new wizard, /team, /campaigns, /settings (tabs: General + Verification)
│   │   ├── auth/                  # /login, /register, /setup, /invite (token), /callback (OAuth)
│   │   └── api/
│   │       ├── institutions/      # GET list (Supabase → local fallback)
│   │       ├── needs/             # GET list, POST create (NGO only)
│   │       ├── pledges/           # GET, POST (+ amount_eur); [id] PATCH delivered; [id]/acknowledge POST
│   │       ├── institution/pledges/  # GET pledges for signed-in NGO
│   │       ├── cron/auto-acknowledge/  # GET; Vercel cron or Bearer CRON_SECRET
│   │       ├── billing/           # Stripe checkout + customer portal
│   │       ├── stripe/webhook/    # subscription lifecycle + idempotent stripe_events
│   │       ├── volunteer-events/  # GET list, POST create (NGO only)
│   │       ├── volunteer-signups/ # GET own signups, POST sign up; [id]/check-in|check-out
│   │       ├── notifications/     # GET, PATCH mark read
│   │       ├── location/          # POST save user lat/lng
│   │       ├── seed/              # POST reseed institutions (admin)
│   │       ├── company-actions/   # v2 corporate quick-log
│   │       ├── oib/lookup/        # GET checksum + registry lookup (rate-limited)
│   │       ├── companies/
│   │       │   ├── route.ts                                 # GET my, POST create
│   │       │   ├── [id]/route.ts                            # GET + PATCH
│   │       │   ├── [id]/members/route.ts                    # GET; [profileId] DELETE
│   │       │   ├── [id]/domains/route.ts                    # GET + POST; [domainId]/verify POST
│   │       │   ├── [id]/invites/route.ts                    # GET + POST (sends Resend invite)
│   │       │   ├── [id]/campaigns/route.ts                  # GET + POST
│   │       │   ├── [id]/receipts/route.ts                   # GET + POST (gated tier+flag); [receiptId]/download
│   │       │   ├── [id]/verification/route.ts                  # GET status, DELETE pending
│   │       │   ├── [id]/verification/lookup/route.ts            # POST OIB → SudReg snapshot (no persist)
│   │       │   ├── [id]/verification/start/route.ts             # POST persist + Resend confirm email
│   │       │   └── invite/accept/route.ts                   # POST accept invite by token
│   │       └── campaigns/[id]/    # PATCH (owner/admin only)
│   ├── i18n/
│   │   ├── hr.json / en.json      # Strings (HR is source of truth)
│   │   ├── dictionaries.ts        # Locale types + resolver + format()
│   │   ├── server.ts              # getLocale(), t(), getTranslator()
│   │   └── client.tsx             # <LocaleProvider>, useT(), useLocale()
│   ├── components/                # See §6
│   └── lib/
│       ├── types.ts               # Domain TS types
│       ├── constants.ts           # CATEGORY_CONFIG, DONATION_TYPES, TAX_CATEGORIES, SDG_GOALS, SIZE_CLASSES, CSRD_WAVES, SUBSCRIPTION_TIERS
│       ├── utils.ts               # timeAgo, urgency helpers, distanceKm, formatDistance, normalizeText
│       ├── notify-nearby.ts       # Haversine 3km notification fan-out
│       ├── local-data.ts          # In-memory fallback when Supabase down/empty
│       ├── institutions-seed.ts   # Curated Zagreb seed list
│       ├── flags.ts               # Feature flags
│       ├── tax.ts                 # Croatian Profit Tax Act ceiling helpers
│       ├── oib.ts                 # OIB checksum (mod 11,10) + registar lookup
│       ├── companies.ts           # requireMembership, slugify, generateToken
│       ├── companies-server.ts    # listMyCompanies, resolveActiveCompany
│       ├── audit.ts               # Append-only hash-chained audit log writer
│       ├── stripe/server.ts       # Stripe client + price/tier helpers
│       ├── billing/gate.ts        # Receipt feature: flag + tier
│       ├── receipts/render.ts     # pdf-lib PDF + XML manifest
│       ├── sudreg/                # client.ts (OAuth2 + lookupCompany), types.ts
│       ├── email/                 # receipt-ready.ts, invite.ts, verify-company.ts (all Resend)
│       ├── auth/                  # Role helpers (roles.ts, server.ts)
│       └── supabase/              # client.ts (anon), server.ts (cookies), admin.ts (service role)
├── supabase/migrations/           # See §5
├── scripts/
│   ├── seed.mjs                       # Seed institutions via service role
│   ├── demo-elevate-company.mjs       # CLI: bump company subscription_tier
│   ├── verify-demo-setup.mjs          # CLI: env smoke test
│   ├── import-registry.mjs            # RegistarUdruga.csv → ngo_registry (idempotent)
│   ├── remap-categories.mjs           # Re-apply category rules in place
│   ├── geocode-registry.mjs           # Fill lat/lng (Nominatim or HERE)
│   ├── promote-registry.mjs           # ngo_registry → institutions on quality bar
│   ├── refresh-event-dates.mjs        # Shift past volunteer_events into the future
│   ├── diagnose-registry.mjs          # Counts + funnel for registry → institutions
│   ├── inspect-registry-coverage.mjs  # Eligibility ladder + samples for tuning
│   ├── apply-migration-014.mjs        # Apply migration via direct pg (--file <name>)
│   └── lib/                           # csv-stream.mjs, category-rules.mjs, supabase-admin.mjs
├── .env.example                       # Env template
├── next.config.ts                     # Image remote patterns
├── postcss.config.mjs                 # Tailwind v4 plugin
├── vercel.json                        # Cron: /api/cron/auto-acknowledge daily 06:00 UTC
├── tsconfig.json                      # Strict TS, @/* alias
├── TECHNICAL_IMPLEMENTATION.md        # Longer technical overview
├── CURSOR_PROMPT.md                   # Legacy 6-bug spec (see §9)
├── CURSOR_ACCESSIBILITY_PROMPT.md     # AccessibilityMenu spec
└── DajSrce_*.xlsx / .docx             # Source-of-truth research data (not code)
```

Generated/ignored: `.next/`, `.vercel/`, `node_modules/`, `tsconfig.tsbuildinfo`, `.env*.local`.

---

## 4. Environment variables

In `.env.local` (git-ignored). Keep this list synced with code.

| Name                                     | Scope       | Phase | Used by                                                                 |
|------------------------------------------|-------------|-------|-------------------------------------------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`               | Public      | 0     | All Supabase clients + middleware                                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`          | Public      | 0     | Browser and SSR clients                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`              | Server only | 0     | `lib/supabase/admin.ts`, `scripts/seed.mjs`, audit + invites            |
| `NEXT_PUBLIC_APP_URL`                    | Public      | 0     | Absolute links in invite/receipt/verify emails                          |
| `OIB_LOOKUP_URL`                         | Server      | 0     | `lib/oib.ts` — defaults to format-only validation if missing            |
| `DEDUCTION_CEILING_PCT`                  | Server      | 0     | `lib/tax.ts` — defaults `"2.0"`, flip to `"4.0"` when law changes       |
| `AUTO_ACKNOWLEDGE_DAYS`                  | Server      | 1     | Cron sweep. Default `"14"`.                                             |
| `CRON_SECRET`                            | Server      | 1     | Bearer for `/api/cron/auto-acknowledge`; Vercel sends `x-vercel-cron: 1`|
| `RESEND_FROM_EMAIL`                      | Server      | 1     | Defaults to Resend onboarding domain if unset                           |
| `RESEND_API_KEY`                         | Server      | 1     | Transactional email (receipts, invites, company verification)           |
| `NEXT_PUBLIC_FLAG_COMPANIES_ENABLED`     | Public      | 0     | `lib/flags.ts` — default `true`                                         |
| `NEXT_PUBLIC_FLAG_RECEIPTS_ENABLED`      | Public      | 1     | `lib/flags.ts` — default `false`                                        |
| `NEXT_PUBLIC_FLAG_EXPORTS_ENABLED`       | Public      | 2     | `lib/flags.ts` — default `false`                                        |
| `NEXT_PUBLIC_FLAG_PUBLIC_PROFILE_ENABLED`| Public      | 3     | `lib/flags.ts` — default `false`                                        |
| `STRIPE_SECRET_KEY`                      | Server      | 1     | Stripe client                                                           |
| `STRIPE_WEBHOOK_SECRET`                  | Server      | 1     | `/api/stripe/webhook`                                                   |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`     | Public      | 1     | Stripe Checkout redirect                                                |
| `STRIPE_PRICE_SME_TAX` / `_SME_PLUS` / `_ENTERPRISE` | Server | 1 | Plan lookup                                                            |
| `ALLOW_DEMO_BILLING`                     | Server      | demo  | Owners/admins can set tier from Settings → Billing without Stripe. **Never enable in production.** |
| `SUDREG_CLIENT_ID`                       | Server      | 0     | OAuth2 client_id for Croatian court registry. Trailing `..` is part of the value. From https://sudreg-data.gov.hr |
| `SUDREG_CLIENT_SECRET`                   | Server      | 0     | OAuth2 secret. Used by `lib/sudreg/client.ts`.                          |
| `SUDREG_API_URL`                         | Server      | 0     | Defaults `https://sudreg-data.gov.hr`. Override for test endpoint.      |

Never expose service role key to the client. `supabaseAdmin` is imported
dynamically inside server route handlers only (e.g. `api/seed`,
`api/needs` POST → `notify-nearby`, `api/volunteer-events` POST,
verification routes).

---

## 5. Data model (Supabase / Postgres)

Authoritative schema lives in `supabase/migrations/`:

- `001_initial_schema.sql` — tables, RLS, indexes, `updated_at` trigger.
- `002_create_profile_trigger.sql` — legacy `handle_new_user()` for the
  old `citizen`/`institution` vocabulary.
- `003_roles_shipping_company_actions.sql` — v2: expands `profiles.role` to
  `individual|ngo|company|superadmin` (migrating any legacy values), adds
  `company_name`/`contact_person`/`organization_verified`, rebuilds the
  signup trigger, adds `company_actions` (per-user CSR log) and `shipments`
  (pledge shipping). Idempotent.
- `004_notifications_and_companies.sql` — ESG Phase 0: `notifications`
  table, full Company tenant model (`companies`, `company_members`,
  `company_domains`, `company_invites`, `campaigns`), pledge extensions
  (`company_id`, `campaign_id`, `match_of_pledge_id`, `tax_category`,
  `fulfilled_at`), `volunteer_signups` extensions (check-in/out + `company_id`),
  hash-chained `audit_log`, `profiles.locale`.
- `005_evidence_and_receipts.sql` — Phase 1: `pledges.amount_eur`,
  `pledges.delivered_at`, `institutions.oib`, `pledge_acknowledgements`,
  `donation_receipts`, RLS, Storage bucket `receipts`.
- `006_billing.sql` — Phase 1: `subscriptions` per company,
  `stripe_events` idempotency log.
- `007_company_members_rls_no_recursion.sql` — replaces self-referential
  `company_members` RLS with `SECURITY DEFINER` helpers (folded into
  current 004 for fresh installs).
- `008_esg_exports_volunteer_hours.sql` — Phase 2: `esg_exports`,
  `volunteer_hours`, `current_user_company_finance_access()`, Storage
  bucket `exports`, NGO policies on `volunteer_signups` + `profiles`.
- `009_volunteer_self_checkin.sql` — volunteers may UPDATE own
  `volunteer_signups` row.
- `010_csr_reports_public_profile.sql` — Phase 3: `company_csr_reports`,
  bucket `reports`, `get_public_company_bundle(slug)` RPC, tightened
  `companies` SELECT (no anonymous full-row read via flag alone).
- `011_institutions_insert_ngo_setup.sql` — RLS `INSERT` on `institutions`
  for authenticated NGO users with `institution_id IS NULL`.
- `012_profiles_rls_no_recursion.sql` — fixes `infinite recursion detected
  in policy for relation profiles` on NGO need/event creation. Replaces the
  self-referential profiles JOIN in the "Institution reads signup volunteer
  profiles" policy with `SECURITY DEFINER current_user_institution_id()`.
- `013_volunteer_signups_rls_no_recursion.sql` — completes 012 by
  rewriting the two `volunteer_signups` policies that joined `profiles`
  (closing the cycle). Replaces with `current_user_institution_id()`.
- `014_ngo_registry.sql` — national NGO directory imported from
  RegistarUdruga.csv. New `ngo_registry` table (raw CSV mirror keyed on OIB
  + geocoded coords + category mapping), `import_state` resumable cursor,
  `institutions.source ∈ {curated,registry,user_claimed}` plus
  `institutions.registry_oib`; `served_population` relaxed to nullable;
  pg_trgm indexes for FT search. Curated rows are never touched by promoter.
- `015_optional_descriptions.sql` — drops NOT NULL on `needs.description`
  and `volunteer_events.description`. Folded into 016 too.
- `016_rls_recursion_consolidated_fix.sql` — self-contained re-apply of the
  SECURITY DEFINER helpers and rewritten policies from 012/013 (which were
  only partially applied to the live DB) plus 015's nullability change.
  Resolves recursion on need/event creation and any pledge insert.
- `017_company_verification.sql` — Phase 0 verification: `company_verifications`
  table (snapshot from SudReg + email-confirm token, partial unique index
  for one in-flight per company). Successful confirmation stamps
  `companies.verified_at`. RLS: members can SELECT their company's row;
  inserts/updates go through service-role API.

All migrations are idempotent (`IF EXISTS` / `OR REPLACE` / `IF NOT EXISTS`).

### Tables

| Table                 | Migration | Purpose                                                                                |
|-----------------------|-----------|----------------------------------------------------------------------------------------|
| `institutions`        | 001→014   | Social institutions; `oib`, `source`, `registry_oib`                                   |
| `profiles`            | 001→004   | 1:1 with `auth.users`; role ∈ `individual|ngo|company|superadmin`, badges, `lat/lng`, `institution_id`, `company_name`, `locale` |
| `needs`               | 001/015   | Institution-posted needs with urgency + progress; `description` nullable               |
| `volunteer_events`    | 001/015   | Institution events; `description` nullable                                             |
| `pledges`             | 001→005   | + `company_id`, `campaign_id`, `match_of_pledge_id`, `tax_category`, `fulfilled_at`, `amount_eur`, `delivered_at`, statuses inc. `delivered`/`confirmed` |
| `pledge_acknowledgements` | 005   | Institution attestation → confirms pledge for receipts                                 |
| `donation_receipts`   | 005       | Company-scoped receipt metadata + storage paths (PDF/XML)                              |
| `subscriptions`       | 006       | Stripe mirror per company                                                              |
| `stripe_events`       | 006       | Webhook idempotency                                                                    |
| `volunteer_signups`   | 001→004   | `(user_id, event_id)` + check-in/out + `company_id`                                    |
| `emergency_alerts`    | 001       | Optional banner messages                                                               |
| `notifications`       | 004       | Per-user proximity notifications                                                       |
| `company_actions`     | 003       | v2 per-user corporate donation quick-log                                               |
| `shipments`           | 003       | v2 pledge shipping metadata                                                            |
| `companies`           | 004       | ESG Phase 0 corporate tenant; `verified_at` stamped by Phase 0 verification flow       |
| `company_members`     | 004       | Many-to-many profiles↔companies; role `owner|admin|finance|employee`                   |
| `company_domains`     | 004       | DNS-TXT-verified email domains for auto-employee linkage                               |
| `company_invites`     | 004       | One-time email invite tokens (14-day TTL)                                              |
| `campaigns`           | 004       | Company giving campaigns with SDG tags                                                 |
| `audit_log`           | 004       | Append-only hash-chained audit trail                                                   |
| `esg_exports`         | 008       | Company ESG ZIPs (framework, period, storage path, manifest)                           |
| `volunteer_hours`     | 008       | Hours per check-out; links signup, user, institution, optional `company_id`            |
| `company_csr_reports` | 010       | CSR PDF/DOCX paths + manifest; finance-tier read; admin insert                         |
| `ngo_registry`        | 014       | Raw RegistarUdruga.csv mirror keyed on OIB + geocoded coords + category mapping        |
| `import_state`        | 014       | Resumable import cursor (job_name → cursor + rows_processed + notes)                   |
| `company_verifications` | 017     | SudReg snapshot + email-confirm token; partial unique index limits to one in-flight    |

### Types / constants (must stay aligned with SQL)

- `src/lib/types.ts`: `Institution`, `Need`, `VolunteerEvent`, `Pledge`,
  `UserProfile`, `Notification`, `Shipment`, `InstitutionCategory`,
  `DonationType`, `UrgencyLevel`, `UserRole`. ESG: `Company`, `CompanyMember`,
  `CompanyRole`, `CompanyDomain`, `CompanyInvite`, `CompanyVerification`,
  `Campaign`, `SubscriptionTier`, `SubscriptionStatus`, `SizeClass`,
  `CsrdWave`, `TaxCategory`, `Framework`, `Locale`, `CompanyPledgeFields`,
  `PledgeWithCompany`, `EsgExport`, `VolunteerHours`, `CompanyCsrReport`,
  `PublicCompanyBundle`.
- `src/lib/constants.ts`: `CATEGORY_CONFIG`, `DONATION_TYPES`,
  `SHIPMENT_METHOD_LABELS`, `COMPANY_ROLE_LABELS`, `TAX_CATEGORIES`,
  `SDG_GOALS`, `SIZE_CLASSES`, `CSRD_WAVES`, `SUBSCRIPTION_TIERS`,
  `FRAMEWORK_LABELS`.
- Institution categories (12): `homeless_shelter`, `soup_kitchen`,
  `children_home`, `caritas`, `disability_support`, `domestic_violence`,
  `elderly_care`, `social_welfare`, `student_housing`, **`mental_health`**,
  **`refugee_migrant_support`**, **`medical_patient_support`** (last three
  added for the registry import).
- Framework compile: `src/lib/frameworks/`. ZIP build: `src/lib/exports/pack.ts`.
- CSR reports: `src/lib/csr-report/`.
- Map defaults: `ZAGREB_CENTER = [45.8131, 15.9775]`, `DEFAULT_ZOOM = 13`.

When adding a column or enum value, update: the migration, `types.ts`, the
relevant `constants.ts` entry, and the Supabase / local fallbacks in API
routes and `local-data.ts`.

### Row-level security summary

- **Institutions:** public SELECT; INSERT for NGO setup (011) when no
  `institution_id` yet; institution-scoped UPDATE.
- **Needs/events/alerts:** public SELECT, institution-scoped INSERT/UPDATE.
- **Profiles:** self-scoped (`auth.uid() = profiles.id`).
- **Pledges/signups:** users own their rows; institutions can additionally
  read pledges for their needs.
- **company_verifications:** members SELECT their company's row; writes via
  service-role.

### Seeding

- Canonical institution data: `src/lib/institutions-seed.ts` (used by both
  `/api/seed` and `scripts/seed.mjs`).
- `getLocalInstitutions` / `getLocalNeeds` / `getLocalVolunteerEvents` in
  `src/lib/local-data.ts` provide an in-memory fallback. Most `/api/*` GETs
  follow **try-Supabase-then-fallback**. Preserve this pattern.

---

## 6. UI components (`src/components`)

| File                          | Role                                                                    |
|-------------------------------|-------------------------------------------------------------------------|
| `Navbar.tsx`                  | Top nav, auth state, notification panel, geolocation opt-in (i18n)     |
| `Footer.tsx`                  | Global footer                                                          |
| `ThemeToggle.tsx`             | Dark/light toggle (persists `localStorage.theme`)                      |
| `AccessibilityMenu.tsx`       | Floating ♿ panel with 8 WCAG 2.1 AA tools                              |
| `Map.tsx`                     | Leaflet map (dynamic import, SSR off); category markers, user dot, fly-to |
| `FilterBar.tsx`               | Filters for `/map` and `/needs`                                        |
| `InstitutionCard.tsx`         | List item; optional distance pill                                      |
| `InstitutionDetailPanel.tsx`  | Side panel for selected institution                                    |
| `NeedCard.tsx` + `PledgeButton.tsx` | Needs board card + pledge modal (sends `credentials: include`)   |
| `VolunteerEventCard.tsx`      | Event card; `isRegistered` prop, sign-up bubbles to parent             |
| `VolunteerCalendar.tsx`       | Month-grid header on `/volunteer`                                      |
| `QuickStartWizard.tsx`        | `/quick-start` (now "Find NGOs"); reverse-geocoded address feedback    |
| `EmergencyBanner.tsx`         | Optional top banner                                                    |
| `BadgeDisplay.tsx`            | Citizen dashboard badges                                               |
| `LocaleSwitcher.tsx`          | HR/EN toggle via server action `setLocaleAction`                       |
| `CompanySwitcher.tsx`         | Dropdown for users with multiple company memberships                   |
| `CompanyReceiptsSection.tsx`  | Phase 1 (tier+flag gated)                                              |
| `CompanyExportsSection.tsx`   | Phase 2 (tier+flag gated)                                              |
| `CompanyCsrReportsSection.tsx`| Phase 3 (tier+flag gated)                                              |
| `CompanyVerificationSection.tsx` | OIB → SudReg snapshot → email confirm (3-step flow inside Settings tab) |
| `PrintConfirmationButton.tsx` | Print dialog on confirmation page (v2)                                 |
| `AuthActionDialog.tsx`        | "Sign in to continue" modal for gated actions                          |

Conventions:

- `"use client"` on every interactive component. Server Components are used
  for route wrappers only.
- Tailwind utility classes; dark variants via `dark:` (custom variant in
  `globals.css`).
- Accessibility: real `<button>`, `aria-label`, `role="dialog"` +
  `aria-modal="true"`, focus traps for the AccessibilityMenu. Mirror
  `PledgeButton` / `AccessibilityMenu`.

---

## 7. Authentication and session handling

- Middleware (`src/middleware.ts`) calls `supabase.auth.getUser()` on every
  non-static request to refresh cookies via `@supabase/ssr`. Gates
  `/dashboard/ngo` **and** `/dashboard/institution` to `role === 'ngo'`.
- Browser: `createClient()` from `lib/supabase/client.ts`.
- Server (route handlers + Server Components): `createServerSupabaseClient()`
  from `lib/supabase/server.ts` (reads/writes the Next.js cookie store).
- `supabaseAdmin` (`lib/supabase/admin.ts`) bypasses RLS — server only.
- OAuth: `/auth/login` → Google → `/auth/callback` → `/auth/setup` (new
  OAuth user with no institution) or `/dashboard`.
- Email/password registration in `src/app/auth/register/page.tsx`. Three role
  tiles (Individual / NGO / Company). Institution/company name in
  `user_metadata.institution_name`. The 003 trigger creates a matching
  `profiles` row and (for NGO signups) an `institutions` row. Company
  signups → `/dashboard/company/new` to complete tenant onboarding.
- Company invites: `POST /api/companies/[id]/invites` creates rows with 14-day
  expiry **and** sends a Resend email with the accept URL. Invitee signs in
  (or creates account), `POST /api/companies/invite/accept` upserts profile,
  inserts `company_members` via supabaseAdmin, marks invite accepted.
- Domain verification: admin adds domain → returns DNS TXT token →
  `POST .../verify` calls `node:dns/promises.resolveTxt` → stamps `verified_at`.
- Company **identity** verification (§13): SudReg lookup + email confirm
  link → stamps `companies.verified_at`.
- Route handlers that insert pledges/signups upsert the profile from
  `user_metadata` as a safety net.

**Client fetches that mutate must include `credentials: "include"`** so the
SSR route handler sees auth cookies. Failure to do so has repeatedly broken
features (see §9).

---

## 8. Proximity notifications

- `src/lib/notify-nearby.ts` exports `notifyNearbyUsers(admin, lat, lng,
  title, body, link, excludeUserId?)`.
- Called from `POST /api/needs` and `POST /api/volunteer-events` after a
  successful insert, using `supabaseAdmin`.
- 3 km bounding box + Haversine filter; one `notifications` row per matching
  citizen (`role = 'citizen'`, non-null `lat`/`lng`).
- Navbar polls `/api/notifications` every 30 s while logged in.
- Coords populated via `POST /api/location` from `saveUserLocation()` in
  `Navbar.tsx` on first load and every auth state change.

---

## 9. Known issues / caveats

Original 6-bug list from `CURSOR_PROMPT.md`:

| # | Description                                                                | Status                   |
|---|----------------------------------------------------------------------------|--------------------------|
| 1 | No `profiles` row created on signup                                        | Fixed via 002 trigger; safety-net upserts in `api/pledges` + `api/volunteer-signups` |
| 2 | Institution registration doesn't create institution / link profile         | Fixed via 002 + `/auth/setup` for OAuth case |
| 3 | `PledgeButton.tsx` missing `credentials: "include"`                        | Fixed in Phase 0 (also supports pledge-on-behalf-of-company) |
| 4 | `VolunteerEventCard.tsx` missing `credentials: "include"`                  | Fixed in Phase 0 |
| 5 | Institution dashboard sent `date` instead of `event_date`                  | Fixed in Phase 0 |
| 6 | FK violation on pledges/signups for users without profiles                 | Mitigated by 002 + safety-net upserts |

If you touch any of these files, fix the matching bug in the same change
and update this table.

Other caveats:

- `lib/supabase/admin.ts` silently falls back to placeholder URL/key in dev;
  ensure prod env vars are set.
- `getLocalNeeds` / `getLocalVolunteerEvents` synthesize fake IDs (`need-0`,
  `local-000`). Don't pledge against these — read-only fallback only.
- `audit.ts` hash chain is best-effort: under concurrent writes two rows may
  share `prev_hash`. Receipt generation may race; consider an advisory lock
  if duplicate receipts emerge.
- Pledges accept optional `amount_eur`. Company headroom hints use
  acknowledged EUR; local demo pledges have no EUR.
- Migration 016 was authored after diagnosis showed 012/013 only partially
  applied to the live DB. If recursion symptoms recur, re-apply 016.
- Resend free tier only delivers to the account-owner email. To send to
  other recipients (invites, verification mails), verify a domain at
  resend.com/domains and set `RESEND_FROM_EMAIL`.
- SudReg: `detalji_subjekta` rate-limited to **6 req/min** per client.
  `lib/sudreg/client.ts` caches the OAuth bearer in module memory until
  5 min before expiry.

---

## 10. Developer workflow

### Commands

```powershell
npm install
npm run dev             # next dev --turbopack (http://localhost:3000)
npm run build
npm run start
npm run lint
npm run demo:elevate -- --slug <slug> --tier enterprise   # CLI tier bump (service role)
npm run demo:check                                        # verify .env.local keys for demo
```

### Database workflow

- Edit/add `supabase/migrations/NNN_description.sql` (idempotent).
- Apply via Supabase SQL Editor (paste + Run) or `supabase db push` (CLI
  workspace `supabase/.temp/`), or
  `node scripts/apply-migration-014.mjs --file <name>` if
  `SUPABASE_DB_PASSWORD` is set in `.env.local`.
- Keep §5 of this file in sync with what's on production.
- Vercel: `vercel.json` schedules `/api/cron/auto-acknowledge` daily 06:00
  UTC. Set `CRON_SECRET` for non-Vercel callers.

### Seeding

- One-shot via app: `POST /api/seed` (service role; gate before production).
- CLI: `SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed.mjs`.
- Past-dated demo events: `node scripts/refresh-event-dates.mjs` shifts them
  into the next 6 weeks (idempotent on future-dated rows).

### Demo / product video (full feature set without prod Stripe)

1. Copy `.env.example` → `.env.local` (or set on Vercel Preview).
2. Run **all** migrations in Supabase. Set Auth Site URL + Redirect URLs
   to your demo origin.
3. Set the three flag envs to `true` so receipts/exports/CSR/public-profile
   UIs appear.
4. `ALLOW_DEMO_BILLING=true` → Settings → Billing → set Enterprise (or
   `npm run demo:elevate -- --slug <slug> --tier enterprise`).
5. Recording flow: create company → campaign → pledge with `amount_eur`
   on behalf of company → receipt → ESG export → CSR report → enable
   public profile.
6. **Before production:** unset `ALLOW_DEMO_BILLING`, use real Stripe.

### What an AI agent (Cursor / Claude Code) can vs cannot do

- **Can:** edit tracked files, append to `.env.local`, run `npm run demo:check`,
  run `npm run demo:elevate` if `SUPABASE_SERVICE_ROLE_KEY` is on the machine.
- **Cannot:** log into Supabase/Vercel dashboards in a browser, change Auth
  redirect URLs, run hosted DB migrations without credentials. To enable
  `supabase db push`, link once: `npx supabase login` →
  `npx supabase link --project-ref <ref>` (subdomain of `NEXT_PUBLIC_SUPABASE_URL`)
  → `npx supabase init` if no `supabase/config.toml`.
- **Vercel env:** paste in the Vercel UI or `npx vercel env pull .env.local`
  after `npx vercel login`.
- **Never paste** `SUPABASE_SERVICE_ROLE_KEY`, Resend API keys, or SudReg
  secrets into chat — keep in `.env.local`.

### Git hygiene

- Default branch `main`; Vercel auto-deploys on push.
- Never commit `.env*.local`, `tsconfig.tsbuildinfo`, or Office `.~lock.*`
  / `*.tmp` files.
- Commit messages: short, imperative, English (e.g. `fix: add credentials:
  include to pledge fetch`).

---

## 11. Conventions and agent guardrails

- **TypeScript strict** — no `any` unless unavoidable; prefer narrow types
  from `src/lib/types.ts`.
- **No new global state libraries** — `useState`/`useReducer` + Supabase
  subscriptions. No Redux/Zustand/etc.
- **Styling** — Tailwind v4 only. Keep dark-mode parity (`dark:`). Respect
  a11y overrides in `globals.css` (`.high-contrast`, `.dyslexia-font`,
  `.highlight-links`, `.increase-spacing`, `.grayscale-mode`, `.big-cursor`,
  `.stop-animations`).
- **Icons** — reuse `lucide-react`. No new icon sets.
- **i18n** — no framework. New TSX strings go through `useT()` /
  `getTranslator()`, keys in `hr.json` + `en.json`. Code identifiers stay
  English.
- **Performance** — `Map.tsx` must remain `dynamic(... { ssr: false })`.
  Keep Leaflet CSS import in `layout.tsx`.
- **Fallback first** — public read APIs follow try-Supabase-then-local.
- **Security** — `@/lib/supabase/admin` only inside `app/api/*/route.ts`
  and server-only helpers. Never bundle for the browser.
- **Accessibility** — don't regress AccessibilityMenu. Touch the a11y
  section of `globals.css` carefully; follow `CURSOR_ACCESSIBILITY_PROMPT.md`.
- **Don't create new top-level Markdown / plan files** unless the user
  explicitly asks. Update this file and `TECHNICAL_IMPLEMENTATION.md` instead.

---

## 12. Keeping this file in sync

Update the relevant section in the same PR when:

- Schema/migrations change → §5
- Env vars change → §4
- New top-level files / route groups → §3
- Auth or session mechanics change → §7
- Bugs in the §9 list change status → §9
- Stack / dep bumps → §2

Update the "Last synced" date at the top whenever you revise this file.

---

## 13. ESG & CSR program (Company tenants)

Roadmap detail in `CLAUDE_CODE_PROMPT_ESG.md`. Phase summaries below — all
phases are shipped.

### Phase 0 — Foundations

- Migration `004_notifications_and_companies.sql`.
- Company tenants: `profiles.role = 'company'` user creates `companies` row
  via `/dashboard/company/new` → becomes `owner` in `company_members`.
- Flags: `NEXT_PUBLIC_FLAG_COMPANIES_ENABLED` defaults `true`.
- i18n: `getTranslator()` (server) / `useT()` (client). `<LocaleSwitcher />`
  uses server action `setLocaleAction` (cookies + revalidatePath).
- Pledge extensions on `/api/pledges` POST: `company_id`, `campaign_id`,
  `request_match`, `tax_category`. Match: mirrored pledge inserted via
  `supabaseAdmin` with `match_of_pledge_id` back-pointer.
- Audit: every mutating company route writes via `writeAuditLog(supabaseAdmin)`.
  Best-effort hash chain (see §9). Never throw from audit writes.
- OIB: `lib/oib.ts` mod 11,10 checksum + optional `OIB_LOOKUP_URL` lookup
  (3 s timeout). `/api/oib/lookup` rate-limits per IP (20/60s sliding window).
- Domain verification: TXT-record check via `node:dns/promises.resolveTxt`.
- **Company identity verification (017):** Owner/admin opens Settings →
  Verification tab. Enters OIB → `POST /api/companies/[id]/verification/lookup`
  hits SudReg `/detalji_subjekta` (no persist). Snapshot rendered side-by-side
  for review. Pick contact email → `.../verification/start` re-fetches SudReg
  authoritatively, persists `company_verifications` row with 24-h token,
  emails confirmation link via Resend (`lib/email/verify-company.ts`). Email
  link → `/verify-company?token=…` (server component) → stamps `confirmed_at`
  + `companies.verified_at`, writes audit, redirects
  `/dashboard/company/settings?cid=<id>&verified=1`. Bad/expired tokens
  render friendly status pages. SudReg client (`lib/sudreg/client.ts`)
  caches OAuth bearer until 5 min before expiry; `SudregNotFoundError` /
  `SudregRateLimitError` map to localised UI errors.

### Phase 1 — Tax receipts + billing

- Migrations 005, 006.
- Pledges: optional `amount_eur`; `PATCH /api/pledges/[id]` → delivered;
  `POST .../acknowledge` (or cron) → confirmed = receipt-eligible.
- Receipts: `POST /api/companies/[id]/receipts` builds PDF/XML via `pdf-lib`,
  uploads to bucket `receipts`, writes `donation_receipts`, emails owner via
  Resend.
- Gating: `NEXT_PUBLIC_FLAG_RECEIPTS_ENABLED` + paid tier (`lib/billing/gate.ts`).
- Stripe: `POST /api/billing/checkout`, `/api/billing/portal`,
  `/api/stripe/webhook` (signature checked).
- Tax helpers: `lib/tax.ts` — `ceilingPct()`, `headroomEur()`.

### Phase 2 — ESG exports

- Migrations 008, 009.
- Exports: `GET`/`POST /api/companies/[id]/exports`, signed download
  `.../[exportId]/download`. Gated by `NEXT_PUBLIC_FLAG_EXPORTS_ENABLED` +
  `SUBSCRIPTION_TIERS[tier].exports` (`sme_plus` → VSME Basic only;
  `enterprise` → all six frameworks).
- Compile: bounded `datapoints.ts` queries via `supabaseAdmin` (no arbitrary
  SQL from JSON). Pack: `data.csv`, `data.json`, `manifest.json`,
  `narrative.pdf`, `evidence/.../summary.pdf` in a ZIP → bucket `exports`.
- Volunteers: `GET /api/institution/volunteer-signups`; NGO
  `POST /api/volunteer-signups/[id]/check-in|check-out`; self-check-in via
  `/volunteer/self-checkin?event=…`. UI: `/dashboard/institution/volunteers`.

### Phase 3 — CSR report + public profile

- Migration 010 (bucket `reports`, RPC, RLS).
- Dashboard: `CompanyCsrReportsSection`; `GET`/`POST
  /api/companies/[id]/csr-reports`; signed download
  `.../[reportId]/download?format=pdf|docx`. Gated by
  `NEXT_PUBLIC_FLAG_PUBLIC_PROFILE_ENABLED` + `SUBSCRIPTION_TIERS[tier].csrReport`.
- Public: `/company/[slug]` (404 if flag off or RPC null),
  `/api/public/company/[slug]/card`, `.../latest-report` (JSON or
  `?redirect=1`), `/api/og/company/[slug]`, embed `/company/[slug]/embed`.
- Settings: owners/admins toggle `public_profile_enabled` when tier+flag
  allow; embed snippet uses `NEXT_PUBLIC_APP_URL`.

### Conventions for all phases

- Additive migrations only. Never drop / rename existing columns.
- `@/lib/supabase/admin` only in server route handlers.
- Mutating client fetches send `credentials: "include"`.
- New TSX through `useT()` / `getTranslator()` — no hard-coded strings
  outside the JSON bundles.
- Keep try-Supabase-then-fallback in public read APIs.
