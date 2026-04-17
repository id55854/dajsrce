# CLAUDE.md — DajSrce Agent Playbook

> Shared context for every AI agent working on this repo. Keep this file up to
> date whenever architecture, data model, conventions, or outstanding work
> changes. If you change anything meaningful, amend the matching section here
> in the same commit.

Last synced: 2026-04-17 (Phase 1: tax receipts, billing, EUR pledges)

---

## 1. Project snapshot

- **Name:** DajSrce ("Give Heart") — a Croatian civic-tech platform connecting
  donors and volunteers with social institutions (shelters, soup kitchens,
  children's homes, Caritas, etc.) in Zagreb.
- **Production:** https://dajsrce.vercel.app (Vercel, auto-deploy from
  `main`).
- **Repo:** https://github.com/id55854/dajsrce.git
- **Primary language:** TypeScript (strict).
- **Framework:** Next.js 15 App Router + React 19 + Tailwind CSS v4 +
  Supabase + Leaflet.
- **Locale:** UI strings are predominantly English; seed data and a few
  user-facing strings are Croatian. Assume a bilingual audience.

### Core user flows

1. Anonymous visitors browse the interactive Leaflet map (`/map`), the Needs
   board (`/needs`), and Volunteer events (`/volunteer`) — no login required
   for read-only browsing.
2. Citizens sign up (email/password or Google OAuth), pledge donations against
   institution needs, and sign up for volunteer events.
3. Institution users can post needs and volunteer events from
   `/dashboard/institution`.
4. A proximity notification system alerts citizens within 3 km of the
   posting institution whenever a new need or volunteer event is created.
5. User coordinates are saved on login via `/api/location` (geolocation
   permission prompted by the Navbar).
6. The bottom-left floating accessibility menu (`AccessibilityMenu`) exposes
   eight WCAG 2.1 AA adjustments persisted in `localStorage`.
7. Croatian companies can register as a **Company tenant** (distinct from the
   per-user `company` role added in v2), go through an OIB-gated onboarding
   wizard, invite employees by token or by verified email domain, create
   giving campaigns, and have their employees pledge on behalf of the
   company with optional match. See §13 for Phase 0 specifics.
8. A lightweight in-repo i18n module (`src/i18n/`) swaps UI copy between
   Croatian (`hr`, default) and English (`en`). Locale persists in a
   `locale` cookie read by both server components and the
   `LocaleSwitcher` client component.
9. **Phase 1:** Pledges can carry optional `amount_eur`. NGOs mark pledges
   **delivered**, then **acknowledge** (manual or cron after
   `AUTO_ACKNOWLEDGE_DAYS`). Companies on a paid Stripe tier with
   `NEXT_PUBLIC_FLAG_RECEIPTS_ENABLED` generate **donation receipts** (PDF +
   XML) into Storage and email the owner via Resend.

---

## 2. Tech stack and key dependencies

Pulled from `package.json`. Pin to these major versions unless the user
requests an upgrade.

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
| DB tooling     | `pg` (scripts only)                       | ^8.20.0  |

Build tooling:

- Turbopack in dev (`next dev --turbopack`).
- TypeScript `strict: true`, path alias `@/* → src/*` (see
  `tsconfig.json`).
- Tailwind v4 consumed via `postcss.config.mjs` + `@import "tailwindcss"`
  in `src/app/globals.css`.

---

## 3. Directory layout

```
dajsrce/
├── src/
│   ├── middleware.ts              # Supabase SSR session refresh on every request
│   ├── app/
│   │   ├── layout.tsx             # Root HTML shell, theme bootstrap, AccessibilityMenu, LocaleProvider
│   │   ├── page.tsx               # Redirects "/" -> "/map"
│   │   ├── globals.css            # Tailwind entry + dark mode + accessibility overrides
│   │   ├── map/                   # Interactive Leaflet map + list view
│   │   ├── needs/                 # Public Needs board with filters
│   │   ├── volunteer/             # Public Volunteer events listing
│   │   ├── quick-start/           # Onboarding wizard
│   │   ├── institution/[id]/      # Public institution detail page
│   │   ├── company/
│   │   │   └── confirmations/[slug]/  # Printable corporate support confirmation (v2)
│   │   ├── dashboard/
│   │   │   ├── page.tsx           # Role-gated router to per-role dashboards
│   │   │   ├── individual/        # Individual dashboard (pledges, badges)
│   │   │   ├── ngo/               # NGO dashboard wrapper (alias to /institution)
│   │   │   ├── institution/       # Institution dashboard (create needs/events)
│   │   │   │   └── pledges/     # Phase 1: list pledges, delivered + acknowledge
│   │   │   ├── admin/             # Superadmin dashboard
│   │   │   └── company/
│   │   │       ├── layout.tsx         # Tenant chrome: switcher + nav (ESG Phase 0)
│   │   │       ├── page.tsx           # Tenant home (metrics, campaigns, recent actions)
│   │   │       ├── new/page.tsx       # 4-step onboarding wizard (OIB → address → brand → invites)
│   │   │       ├── new-action/        # Legacy per-action quick-log (v2)
│   │   │       ├── team/              # Members + invites + domain verification
│   │   │       ├── campaigns/         # Campaign list + create/edit
│   │   │       └── settings/          # Company profile, brand, finance, Stripe billing panel
│   │   ├── auth/
│   │   │   ├── login/             # Email+password + Google OAuth login
│   │   │   ├── register/          # Role-gated signup (individual | ngo | company)
│   │   │   ├── setup/             # Post-OAuth role/institution setup
│   │   │   ├── invite/            # Accept a company invite token (ESG Phase 0)
│   │   │   └── callback/route.ts  # Supabase OAuth code exchange
│   │   └── api/
│   │       ├── institutions/      # GET: list (Supabase -> local fallback)
│   │       ├── needs/             # GET list, POST create (institution only)
│   │       ├── pledges/           # GET my pledges, POST (+ amount_eur); [id] PATCH delivered; [id]/acknowledge POST
│   │       ├── institution/pledges/  # GET pledges for signed-in NGO institution
│   │       ├── cron/auto-acknowledge/  # GET: auto-ack old delivered pledges (Vercel cron or Bearer CRON_SECRET)
│   │       ├── billing/           # checkout + Stripe customer portal
│   │       ├── stripe/webhook/    # subscription lifecycle, idempotent stripe_events
│   │       ├── volunteer-events/  # GET list, POST create (institution only)
│   │       ├── volunteer-signups/ # POST sign up for event
│   │       ├── notifications/     # GET list, PATCH mark read / all read
│   │       ├── location/          # POST save user lat/lng
│   │       ├── seed/              # POST reseed institutions (admin)
│   │       ├── company-actions/   # v2 corporate quick-log actions
│   │       ├── oib/lookup/        # GET checksum + registry lookup (rate-limited)
│   │       ├── companies/
│   │       │   ├── route.ts                                 # GET my companies, POST create
│   │       │   ├── [id]/route.ts                            # GET + PATCH company
│   │       │   ├── [id]/members/route.ts                    # GET members
│   │       │   ├── [id]/members/[profileId]/route.ts        # DELETE member
│   │       │   ├── [id]/domains/route.ts                    # GET + POST domains
│   │       │   ├── [id]/domains/[domainId]/verify/route.ts  # POST DNS TXT verify
│   │       │   ├── [id]/invites/route.ts                    # GET + POST invites
│   │       │   ├── [id]/campaigns/route.ts                  # GET + POST campaigns
│   │       │   ├── [id]/receipts/route.ts                   # GET list, POST generate (gated tier + flag)
│   │       │   ├── [id]/receipts/[receiptId]/download/route.ts  # signed URL ?format=pdf|xml
│   │       │   └── invite/accept/route.ts                   # POST accept invite by token
│   │       └── campaigns/[id]/    # PATCH campaign (owner/admin only)
│   ├── i18n/                      # In-repo i18n (hr default, en fallback)
│   │   ├── hr.json                # Croatian strings (source of truth)
│   │   ├── en.json                # English strings
│   │   ├── dictionaries.ts        # Locale types + resolver + format()
│   │   ├── server.ts              # Server Component helper: getLocale(), t(), getTranslator()
│   │   └── client.tsx             # <LocaleProvider>, useT(), useLocale()
│   ├── components/                # Client UI (see section 6)
│   └── lib/
│       ├── types.ts               # Domain TypeScript types (extended for company/campaign/etc.)
│       ├── constants.ts           # CATEGORY_CONFIG, DONATION_TYPES, TAX_CATEGORIES, SDG_GOALS, SIZE_CLASSES, CSRD_WAVES, SUBSCRIPTION_TIERS
│       ├── utils.ts               # timeAgo, urgency helpers, distanceKm
│       ├── notify-nearby.ts       # Haversine-based 3km notification fan-out
│       ├── local-data.ts          # In-memory fallback when Supabase is down/empty
│       ├── institutions-seed.ts   # Source-of-truth Zagreb institution seed list
│       ├── flags.ts               # Feature flags (companies/receipts/exports/public-profile)
│       ├── tax.ts                 # Croatian Profit Tax Act deduction-ceiling helpers
│       ├── oib.ts                 # OIB checksum (mod 11,10) + registar lookup
│       ├── companies.ts           # Shared: requireMembership, slugify, generateToken
│       ├── companies-server.ts    # Server-only: listMyCompanies, resolveActiveCompany
│       ├── audit.ts               # Append-only hash-chained audit log writer
│       ├── stripe/server.ts       # Stripe client + price/tier helpers (Phase 1)
│       ├── billing/gate.ts        # Receipt feature: flag + subscription tier
│       ├── receipts/render.ts     # pdf-lib PDF + XML manifest
│       ├── email/receipt-ready.ts # Resend HTML for new receipt
│       ├── auth/                  # Role helpers (v2)
│       │   ├── roles.ts
│       │   └── server.ts
│       └── supabase/
│           ├── client.ts          # Browser client (anon key)
│           ├── server.ts          # Server Component/Route Handler client (cookies)
│           └── admin.ts           # Service-role client (server only)
├── supabase/migrations/           # Raw SQL migrations (see section 5)
├── scripts/seed.mjs               # Node script to seed institutions via service role
├── next.config.ts                 # Image remote patterns only
├── postcss.config.mjs             # Tailwind v4 postcss plugin
├── vercel.json                    # Cron: /api/cron/auto-acknowledge (daily 06:00 UTC)
├── tsconfig.json                  # Strict TS, @/* alias
├── TECHNICAL_IMPLEMENTATION.md    # Longer-form technical overview
├── CURSOR_PROMPT.md               # Legacy prompt listing 6 critical bugs (see §9)
├── CURSOR_ACCESSIBILITY_PROMPT.md # Legacy spec for AccessibilityMenu
└── DajSrce_*.xlsx / .docx         # Source-of-truth research data (not code)
```

Generated or ignored: `.next/`, `.vercel/`, `node_modules/`,
`tsconfig.tsbuildinfo`, any `.env*.local`.

---

## 4. Environment variables

Declared in `.env.local` (git-ignored). Keep this list in sync with code:

| Name                                     | Scope       | Phase | Used by                                                                 |
|------------------------------------------|-------------|-------|-------------------------------------------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`               | Public      | 0     | All Supabase clients (`client.ts`, `server.ts`, `admin.ts`, middleware) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`          | Public      | 0     | Browser and SSR clients                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`              | Server only | 0     | `src/lib/supabase/admin.ts`, `scripts/seed.mjs`, audit + invites        |
| `NEXT_PUBLIC_APP_URL`                    | Public      | 0     | Absolute links in invite emails + receipts                              |
| `OIB_LOOKUP_URL`                         | Server      | 0     | `src/lib/oib.ts` — defaults to format-only validation if missing        |
| `DEDUCTION_CEILING_PCT`                  | Server      | 0     | `src/lib/tax.ts` — defaults to `"2.0"`, flip to `"4.0"` when law changes |
| `AUTO_ACKNOWLEDGE_DAYS`                  | Server      | 1     | Cron auto-acknowledgement sweep. Default `"14"`.                         |
| `CRON_SECRET`                            | Server      | 1     | Optional Bearer for `/api/cron/auto-acknowledge`; Vercel cron uses `x-vercel-cron: 1` |
| `RESEND_FROM_EMAIL`                      | Server      | 1     | `receipt-ready.ts` — defaults to Resend onboarding domain if unset         |
| `NEXT_PUBLIC_FLAG_COMPANIES_ENABLED`     | Public      | 0     | `src/lib/flags.ts` — default `true`                                      |
| `NEXT_PUBLIC_FLAG_RECEIPTS_ENABLED`      | Public      | 1     | `src/lib/flags.ts` — default `false`                                     |
| `NEXT_PUBLIC_FLAG_EXPORTS_ENABLED`       | Public      | 2     | `src/lib/flags.ts` — default `false`                                     |
| `NEXT_PUBLIC_FLAG_PUBLIC_PROFILE_ENABLED`| Public      | 3     | `src/lib/flags.ts` — default `false`                                     |
| `STRIPE_SECRET_KEY`                      | Server      | 1     | Stripe client (Phase 1+)                                                 |
| `STRIPE_WEBHOOK_SECRET`                  | Server      | 1     | `/api/stripe/webhook` (Phase 1+)                                         |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`     | Public      | 1     | Stripe Checkout redirect (Phase 1+)                                      |
| `STRIPE_PRICE_SME_TAX`                   | Server      | 1     | Plan lookup (Phase 1+)                                                   |
| `STRIPE_PRICE_SME_PLUS`                  | Server      | 1     | Plan lookup (Phase 1+)                                                   |
| `STRIPE_PRICE_ENTERPRISE`                | Server      | 1     | Plan lookup (Phase 1+)                                                   |
| `RESEND_API_KEY`                         | Server      | 1     | Transactional email (Phase 1+)                                           |

Do **not** expose the service role key to the client. `supabaseAdmin` is
imported dynamically inside server route handlers only
(`api/seed`, `api/needs` POST → `notify-nearby`, `api/volunteer-events` POST).

---

## 5. Data model (Supabase / Postgres)

Authoritative schema lives in `supabase/migrations/`:

- `001_initial_schema.sql` — tables, RLS policies, indexes, `updated_at`
  trigger.
- `002_create_profile_trigger.sql` — legacy `public.handle_new_user()` trigger
  for the old `citizen`/`institution` vocabulary.
- `003_roles_shipping_company_actions.sql` — v2: expands the role check to
  `individual|ngo|company|superadmin`, rebuilds the signup trigger, and adds
  `company_actions` (per-user CSR log) + `shipments` (pledge shipping).
- `004_notifications_and_companies.sql` — ESG Phase 0: adds the previously-
  implicit `notifications` table, the Company tenant model (`companies`,
  `company_members`, `company_domains`, `company_invites`, `campaigns`),
  extends `pledges` with company/campaign/match/tax_category/fulfilled_at,
  extends `volunteer_signups` with check-in/out + company_id, and adds the
  hash-chained `audit_log` table. Adds `profiles.locale` too.
- `005_evidence_and_receipts.sql` — Phase 1: `pledges.amount_eur`,
  `pledges.delivered_at`, `institutions.oib`, `pledge_acknowledgements`,
  `donation_receipts`, RLS, Storage bucket `receipts`.
- `006_billing.sql` — Phase 1: `subscriptions` (one row per `company_id`),
  `stripe_events` idempotency log, `updated_at` trigger.
- `003_roles_shipping_company_actions.sql` — expands `profiles.role` to
  `individual | ngo | company | superadmin` (migrating any legacy
  `citizen`/`institution` rows), adds `company_name`/`contact_person`/
  `organization_verified` columns, rebuilds the signup trigger so it
  understands the new role vocabulary and persists `company_name`, and
  creates the `company_actions` and `shipments` tables + RLS policies.
  Safe to re-run.

### Tables

| Table                        | Migration | Purpose                                                                 |
|------------------------------|-----------|-------------------------------------------------------------------------|
| `institutions`               | 001→005   | Social institutions; Phase 1 adds optional `oib` for receipts                |
| `profiles`                   | 001→004   | 1:1 with `auth.users`; role ∈ `individual|ngo|company|superadmin`, stats, badges, optional `lat/lng`, optional `institution_id`, `company_name`, `locale` |
| `needs`                      | 001       | Institution-posted material needs with urgency + progress counters       |
| `volunteer_events`           | 001       | Institution-posted events with date/time window and needed volunteers    |
| `pledges`                    | 001→005   | Pledge against a need; Phase 0: `company_id`, `campaign_id`, `match_of_pledge_id`, `tax_category`, `fulfilled_at`. Phase 1: `amount_eur`, `delivered_at`, `status` includes `delivered` / `confirmed` |
| `pledge_acknowledgements`    | 005       | Institution attestation (signature hash, notes) → confirms pledge for receipts |
| `donation_receipts`          | 005       | Company-scoped receipt metadata + storage paths for PDF/XML                    |
| `subscriptions`              | 006       | Stripe subscription mirror per company (`stripe_customer_id`, tier, period end) |
| `stripe_events`              | 006       | Processed webhook event ids (idempotency)                                      |
| `volunteer_signups`          | 001→004   | `(user_id, event_id)` + `checked_in_at`, `checked_out_at`, `company_id` |
| `emergency_alerts`           | 001       | Optional banner messages                                                 |
| `notifications`              | 004       | Per-user proximity notifications (created by `notify-nearby.ts`)         |
| `company_actions`            | 003       | v2 per-user corporate donation quick-log                                 |
| `shipments`                  | 003       | v2 pledge shipping metadata (carrier-agnostic)                           |
| `companies`                  | 004       | ESG Phase 0 corporate tenant (legal_name, slug, oib, brand, revenue, tier) |
| `company_members`            | 004       | Many-to-many profiles↔companies with role `owner|admin|finance|employee` |
| `company_domains`            | 004       | Verified email domains for auto-employee linkage (DNS TXT)               |
| `company_invites`            | 004       | One-time email invite tokens (14-day TTL)                                |
| `campaigns`                  | 004       | Company-scoped giving campaigns with SDG tags and optional target        |
| `audit_log`                  | 004       | Append-only hash-chained audit trail for company-scoped mutations        |

### Types / constants (must stay aligned with SQL)

- Domain types: `src/lib/types.ts` (`Institution`, `Need`,
  `VolunteerEvent`, `Pledge`, `UserProfile`, `Notification`,
  `Shipment`, `InstitutionCategory`, `DonationType`, `UrgencyLevel`,
  `UserRole`). ESG Phase 0 adds: `Company`, `CompanyMember`,
  `CompanyRole`, `CompanyDomain`, `CompanyInvite`, `Campaign`,
  `SubscriptionTier`, `SubscriptionStatus`, `SizeClass`, `CsrdWave`,
  `TaxCategory`, `Framework`, `Locale`, `CompanyPledgeFields`,
  `PledgeWithCompany`.
- UI/display config: `src/lib/constants.ts` (`CATEGORY_CONFIG`,
  `DONATION_TYPES`, `SHIPMENT_METHOD_LABELS`, `COMPANY_ROLE_LABELS`,
  `TAX_CATEGORIES`, `SDG_GOALS`, `SIZE_CLASSES`, `CSRD_WAVES`,
  `SUBSCRIPTION_TIERS`).
- Feature flags: `src/lib/flags.ts`.
- Map defaults: `ZAGREB_CENTER = [45.8131, 15.9775]`, `DEFAULT_ZOOM = 13`.

When you add a column or enum value, update: the migration, `types.ts`,
any relevant entry in `constants.ts`, and the Supabase/local fallbacks
inside API routes and `src/lib/local-data.ts`.

### Row-level security summary

- Institutions, needs, events, alerts: public `select`, institution-scoped
  `insert`/`update` (`profiles.institution_id = <row>.institution_id`).
- Profiles: self-scoped `select`/`update`/`insert`
  (`auth.uid() = profiles.id`).
- Pledges / signups: users read/write their own rows; institutions can
  additionally read pledges for their needs.

### Seeding

- Canonical institution data in `src/lib/institutions-seed.ts` (imported by
  both `src/app/api/seed/route.ts` and `scripts/seed.mjs`).
- `getLocalInstitutions`, `getLocalNeeds`, `getLocalVolunteerEvents` in
  `src/lib/local-data.ts` provide an in-memory fallback used whenever
  Supabase calls fail or return empty — most `/api/*` GET handlers follow a
  **try-Supabase-then-fallback** pattern. Preserve this pattern so the
  public site still renders without a database.

---

## 6. UI components (`src/components`)

| File                          | Role                                                                 |
|-------------------------------|----------------------------------------------------------------------|
| `Navbar.tsx`                  | Top navigation, auth state, notification panel, geolocation opt-in   |
| `Footer.tsx`                  | Global footer                                                        |
| `ThemeToggle.tsx`             | Dark/light toggle (persists `localStorage.theme`)                    |
| `AccessibilityMenu.tsx`       | Floating bottom-left ♿ panel with 8 WCAG 2.1 AA tools                |
| `Map.tsx`                     | Leaflet map (dynamic import, SSR disabled) with category markers     |
| `FilterBar.tsx`               | Category/donation/zagreb/urgent filters for `/map` and `/needs`      |
| `InstitutionCard.tsx`         | Compact list item used on map aside                                  |
| `InstitutionDetailPanel.tsx`  | Side panel for selected institution                                  |
| `NeedCard.tsx` + `PledgeButton.tsx` | Needs board card + pledge modal                                  |
| `VolunteerEventCard.tsx`      | Event card + sign-up button                                          |
| `QuickStartWizard.tsx`        | `/quick-start` onboarding                                            |
| `EmergencyBanner.tsx`         | Optional top banner                                                  |
| `BadgeDisplay.tsx`            | Citizen dashboard badges                                             |
| `LocaleSwitcher.tsx`          | HR/EN toggle — writes `locale` cookie and reloads (ESG Phase 0)      |
| `CompanySwitcher.tsx`         | Dropdown for users with multiple company memberships (ESG Phase 0)   |
| `CompanyReceiptsSection.tsx`| Phase 1: generate/list/download donation receipts (tier + flag gated)  |
| `PrintConfirmationButton.tsx` | Trigger print dialog on the confirmation page (v2)                   |
| `AuthActionDialog.tsx`        | Common "sign in to continue" modal for gated actions (v2)            |

Conventions:

- `"use client"` on every interactive component. Server Components are
  used for route wrappers only (e.g. simple pages that redirect).
- Use Tailwind utility classes; dark variants via `dark:` using the
  custom `@custom-variant dark (&:where(.dark, .dark *));` declared in
  `globals.css`.
- Accessibility: real `<button>`, `aria-label`, `role="dialog"` +
  `aria-modal="true"` for modals, focus traps for the
  `AccessibilityMenu` dialog. Follow the pattern in existing modals
  (`PledgeButton`, `AccessibilityMenu`).

---

## 7. Authentication and session handling

- Middleware (`src/middleware.ts`) calls `supabase.auth.getUser()` on every
  non-static request to refresh cookies via `@supabase/ssr`.
- Browser code uses `createClient()` from `src/lib/supabase/client.ts`.
- Server code uses `createServerSupabaseClient()` from
  `src/lib/supabase/server.ts`. Use this in route handlers and Server
  Components; it reads/writes the Next.js cookie store.
- `supabaseAdmin` (`src/lib/supabase/admin.ts`) bypasses RLS with the
  service role key — use it **only** inside server route handlers and
  only when strictly necessary (currently: seeding and the proximity
  notification fan-out).
- OAuth flow: `/auth/login` → Google → `/auth/callback` → either
  `/auth/setup` (new OAuth user with no institution) or `/dashboard`.
- Registration for email/password is in `src/app/auth/register/page.tsx`.
  It presents three role tiles (Individual / NGO / Company). Institution
  or company name is stored in `user_metadata.institution_name`; the
  migration 003 trigger creates a matching `profiles` row and, for NGO
  signups, an `institutions` row. Company signups are redirected to
  `/dashboard/company/new` post-signup to complete tenant onboarding
  (OIB, brand, invites) which writes a `companies` row and an
  `owner`-level `company_members` row.
- Company invites flow: `POST /api/companies/[id]/invites` creates
  `company_invites` rows with 14-day expiry. The caller receives
  `accept_url` pointing at `/auth/invite?token=…`. The invitee signs in
  (or creates an account), then `POST /api/companies/invite/accept`
  upserts `profiles`, inserts `company_members` (via `supabaseAdmin`
  since the invitee isn't yet a member and RLS would block), and marks
  the invite accepted.
- Domain verification: admin adds a domain → `POST /api/companies/[id]/domains`
  returns a `dajsrce-verify=<hex>` DNS TXT token. `POST .../verify`
  calls `node:dns/promises.resolveTxt` server-side and stamps
  `verified_at` on match.
- Route handlers that insert pledges/signups double-check the profile
  exists and upsert it from `user_metadata` as a safety net.

**Client fetches that mutate must include `credentials: "include"`** so the
SSR route handler can see the auth cookies. Failure to do so has repeatedly
broken features; see §9.

---

## 8. Proximity notifications

- `src/lib/notify-nearby.ts` exports `notifyNearbyUsers(admin, lat, lng,
  title, body, link, excludeUserId?)`.
- Called from `POST /api/needs` and `POST /api/volunteer-events` after
  a successful insert, using the `supabaseAdmin` client.
- Implementation uses a 3 km bounding box + Haversine distance filter;
  writes one `notifications` row per matching citizen (profiles with
  `role = 'citizen'` and a non-null `lat`/`lng`).
- The Navbar polls `/api/notifications` every 30 seconds while a user is
  logged in.
- User coordinates are populated via `POST /api/location`, triggered from
  `saveUserLocation()` inside `Navbar.tsx` on first load and every auth
  state change.

---

## 9. Known outstanding issues

These are documented in `CURSOR_PROMPT.md` as "6 critical bugs". Status as
of this sync:

| # | Description                                                                 | Status                   |
|---|-----------------------------------------------------------------------------|--------------------------|
| 1 | No `profiles` row created on signup                                          | Fixed via migration 002 (trigger). Client-side fallback in `register/page.tsx` is **not** implemented; safety nets exist in `api/pledges` and `api/volunteer-signups`. |
| 2 | Institution registration doesn't create an institution / link profile        | Fixed via migration 002 trigger for new signups. `/auth/setup` covers the OAuth case. |
| 3 | `PledgeButton.tsx` fetch missing `credentials: "include"`                    | **Fixed in Phase 0** — `src/components/PledgeButton.tsx` now passes `credentials: "include"` and supports pledge-on-behalf-of-company. |
| 4 | `VolunteerEventCard.tsx` fetch missing `credentials: "include"`              | **Fixed in Phase 0** — `src/components/VolunteerEventCard.tsx`. |
| 5 | Institution dashboard sends `date` instead of `event_date`                   | **Fixed in Phase 0** — `src/app/dashboard/institution/page.tsx` now sends `event_date`. |
| 6 | FK violation on pledges/signups for users without profiles                   | Mitigated by migration 002 + safety-net upserts in `api/pledges` and `api/volunteer-signups`. |

If you touch any of these files, fix the matching bug in the same change and
update this table.

Other areas that warrant attention:

- ~~`notifications` table is not in the committed migrations.~~ **Fixed in
  Phase 0 migration 004.**
- `src/lib/supabase/admin.ts` silently falls back to placeholder URL/key in
  development; ensure production env vars are set.
- `getLocalNeeds` / `getLocalVolunteerEvents` synthesize IDs like
  `need-0`, `local-000`. Do not try to pledge against these IDs — they
  only exist for read-only browsing without Supabase.
- `audit.ts` best-effort hash chain: under concurrent writes two rows can
  both reference the same `prev_hash`. Receipt generation may still race;
  consider an advisory lock if duplicate receipts become an issue.
- Pledges accept optional **`amount_eur`** (POST `/api/pledges`). Company
  dashboard headroom hints use acknowledged EUR where implemented; local
  demo pledges still have no EUR.

---

## 10. Developer workflow

### Commands (Windows PowerShell)

```powershell
npm install             # once
npm run dev             # next dev --turbopack (http://localhost:3000)
npm run build           # production build
npm run start           # run built app
npm run lint            # next lint
```

### Database workflow

- Edit or add a file in `supabase/migrations/NNN_description.sql`.
- Apply with the Supabase CLI (`supabase db push`) or paste into the
  Supabase SQL editor. The CLI workspace folder is `supabase/.temp/`.
- Keep §5 of this file in sync with whatever lives on production.
- **Vercel:** `vercel.json` schedules `GET /api/cron/auto-acknowledge` daily
  (06:00 UTC). Set `CRON_SECRET` if you need non-Vercel callers; Vercel
  injects `x-vercel-cron: 1`.

### Seeding

- One-shot seeding through the app: `POST /api/seed` (uses
  `supabaseAdmin`; requires the service role key to be set and the route
  to remain reachable — consider gating it before production).
- CLI-style seed: `SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed.mjs`.

### Git hygiene

- Default branch is `main`; Vercel auto-deploys on push.
- Never commit anything under `.env*.local`, `tsconfig.tsbuildinfo`, or
  `.~lock.*` Office temporary files (already in `.gitignore` or should
  not be staged).
- Keep commit messages short, imperative, English (e.g. `fix: add
  credentials: include to pledge fetch`).

---

## 11. Conventions and agent guardrails

- **TypeScript strict** — no `any` unless unavoidable; prefer unions and
  narrow types from `src/lib/types.ts`.
- **No new global state libraries** — use `useState`/`useReducer` and
  Supabase subscriptions. Avoid introducing Redux/Zustand/etc.
- **Styling** — Tailwind v4 only. Keep dark-mode parity (`dark:` variants)
  for any new surface. Respect the accessibility overrides in
  `globals.css` (`.high-contrast`, `.dyslexia-font`, `.highlight-links`,
  `.increase-spacing`, `.grayscale-mode`, `.big-cursor`,
  `.stop-animations`).
- **Icons** — reuse `lucide-react`; if an icon is missing, add it to the
  existing import groups rather than introducing a new icon set.
- **i18n** — there is no i18n framework. Mixed English/Croatian is
  acceptable for user-facing labels; keep code identifiers in English.
- **Performance** — `Map.tsx` must remain `dynamic(... { ssr: false })`.
  Keep Leaflet CSS import in `layout.tsx`.
- **Fallback first** — when adding read APIs, mirror the
  try-Supabase-then-fallback pattern so `/map` and `/needs` keep working
  in demo mode.
- **Security** — never import `@/lib/supabase/admin` from a client
  component or a shared utility that gets bundled for the browser. Keep
  usage inside `app/api/*/route.ts` files and their server-only helpers.
- **Accessibility** — do not regress the AccessibilityMenu. Touch
  `globals.css` a11y section with care and follow the keyboard/focus
  spec in `CURSOR_ACCESSIBILITY_PROMPT.md`.
- **Do not create new top-level Markdown / plan files** unless the user
  explicitly asks. Update this file and `TECHNICAL_IMPLEMENTATION.md`
  instead.

---

## 13. ESG & CSR program (Company tenants)

The four-PR ESG/CSR roadmap is specified in full in
`CLAUDE_CODE_PROMPT_ESG.md` at the repo root. Phase 0 (foundations) has
landed and is summarized here so future agents don't need to re-read the
brief end-to-end.

### Phase 0 — Foundations (shipped)

- Migration `004_notifications_and_companies.sql` is in-tree (see §5).
- Company tenants are additive to the existing per-user `company` role:
  a user with `profiles.role = 'company'` creates a `companies` row via
  `/dashboard/company/new` and becomes its `owner` in `company_members`.
- Feature flags: `NEXT_PUBLIC_FLAG_COMPANIES_ENABLED` defaults `true`;
  receipts / exports / public profile default `false` until their phases.
- i18n: Croatian default, English secondary. Keys live in
  `src/i18n/hr.json` and `src/i18n/en.json`. Server components call
  `getTranslator()` from `src/i18n/server.ts`; client components use
  `useT()` from `src/i18n/client.tsx`. `<LocaleSwitcher />` is mounted
  in `Navbar.tsx` and writes a `locale` cookie.
- Pledge extensions: `/api/pledges` POST accepts optional
  `company_id`, `campaign_id`, `request_match`, `tax_category`. When
  `request_match` is set and the caller's company has `default_match_ratio > 0`,
  a mirrored match pledge is inserted via `supabaseAdmin` with
  `match_of_pledge_id` back-pointer.
- Audit trail: every mutating company route writes to `audit_log` via
  `writeAuditLog(supabaseAdmin, …)`. The hash chain is best-effort (see
  §9). Never throw from audit writes.
- OIB validation: `src/lib/oib.ts` does mod 11,10 checksum; optional
  registrar lookup via `OIB_LOOKUP_URL` with 3-second timeout and graceful
  fallback. The `/api/oib/lookup` endpoint rate-limits per IP
  (sliding window, 20 hits / 60 s).
- Domain verification: TXT-record check via `node:dns/promises.resolveTxt`
  in `/api/companies/[id]/domains/[domainId]/verify`.

### Phase 1 — Tax receipts + billing (shipped in repo)

- Migrations `005_evidence_and_receipts.sql`, `006_billing.sql` (see §5).
- **Pledges:** optional `amount_eur`; `PATCH /api/pledges/[id]` sets
  **delivered**; `POST .../acknowledge` or cron confirms for receipt eligibility.
- **Receipts:** `POST /api/companies/[id]/receipts` builds PDF/XML via
  `pdf-lib`, uploads to bucket `receipts`, writes `donation_receipts`,
  emails via Resend (`RESEND_API_KEY`, optional `RESEND_FROM_EMAIL`).
- **Gating:** `NEXT_PUBLIC_FLAG_RECEIPTS_ENABLED` and paid tier via
  `src/lib/billing/gate.ts` (Stripe `subscriptions` row).
- **Stripe:** `POST /api/billing/checkout`, `POST /api/billing/portal`,
  `POST /api/stripe/webhook` (`STRIPE_WEBHOOK_SECRET`, price envs in §4).
- **Tax helpers:** `src/lib/tax.ts` — `ceilingPct()`, `headroomEur()`, etc.

### Phase 2 — ESG exports (not yet shipped)

See `CLAUDE_CODE_PROMPT_ESG.md` §8. Framework manifests will live in
`src/lib/frameworks/`. Volunteer check-in/out columns on
`volunteer_signups` were added in migration 004 to avoid churn later.

### Phase 3 — CSR report + public profile (not yet shipped)

See `CLAUDE_CODE_PROMPT_ESG.md` §9. `companies.public_profile_enabled`,
`tagline`, `social` columns were added in migration 004 as part of the
additive design; the public `/company/[slug]` route and gated RLS will
land in Phase 3.

### Conventions for all phases

- Additive migrations only. Never drop / rename existing columns.
- Import `@/lib/supabase/admin` only in server route handlers.
- Client fetches that mutate must send `credentials: "include"`.
- All new pages must pass through `useT()` / `getTranslator()` — no
  hard-coded Croatian or English strings in TSX outside the JSON bundles.
- Keep the try-Supabase-then-fallback pattern in public read APIs.

---

## 12. Keeping this file in sync

When any of the following change, update the relevant section **in the
same PR**:

- Schema / migrations → §5.
- Env vars → §4.
- Directory layout or new top-level files → §3.
- Auth or session mechanics → §7.
- Bug fixes or regressions in the known-issues list → §9.
- Dependency bumps that affect the stack summary → §2.

Update the "Last synced" date at the top whenever you revise this file.
