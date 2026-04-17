# Claude Code brief — ESG & CSR module for DajSrce

> **Purpose**: implement the full ESG/CSR reporting product on top of the
> existing DajSrce codebase. All features are gated behind a new **Company**
> tenant type; citizen and institution experiences remain free and unchanged.
> Deliver the work across four sequenced pull requests (one per phase).
>
> This brief is self-contained. Before writing any code, read `CLAUDE.md` at
> the repo root and `DajSrce_ESG_Implementation_Plan.docx` for the product
> rationale. If any requirement here contradicts `CLAUDE.md`, `CLAUDE.md` wins
> — ask the user before deviating.

---

## 0. Operating rules

1. **Work in 4 PRs**, one per phase, each shippable on its own:
   - `feat/esg-phase-0-foundations`
   - `feat/esg-phase-1-tax-receipts`
   - `feat/esg-phase-2-esg-exports`
   - `feat/esg-phase-3-reports-and-profile`

   Each PR must build (`npm run build`), lint clean (`npm run lint`),
   and include its own migration(s). Later PRs may depend on earlier PRs
   but must never break the public site (`/map`, `/needs`, `/volunteer`)
   or the citizen/institution dashboards.

2. **Additive only.** Never drop or rename existing tables, columns,
   routes, or components. Extend via nullable columns or new tables.
   Preserve the try-Supabase-then-fallback pattern in all read APIs.

3. **TypeScript strict.** No `any` unless unavoidable; prefer narrow types
   from `src/lib/types.ts`. No new global state libraries (Redux/Zustand).

4. **Tailwind v4 + dark-mode parity.** Every new surface must support
   `.dark` and the accessibility overrides in `src/app/globals.css`.

5. **Security.**
   - Never import `@/lib/supabase/admin` from a client component or any
     file that can be bundled for the browser.
   - Every mutating client `fetch` must pass `credentials: "include"`.
   - Every new API route must enforce authentication and RLS; no
     `supabaseAdmin` usage without a written justification in the PR
     description.

6. **Bugs to fix in the same touching-PR.** The three bugs listed in
   `CLAUDE.md` §9 (missing `credentials: "include"` in `PledgeButton.tsx`
   and `VolunteerEventCard.tsx`; `date` vs `event_date` in
   `dashboard/institution/page.tsx`) must be fixed whenever Phase 0 or
   Phase 1 touches those files. If a phase touches them, fix them and
   update `CLAUDE.md` §9.

7. **Keep `CLAUDE.md` in sync.** Every phase must update the relevant
   sections of `CLAUDE.md` (§3 layout, §4 env vars, §5 data model, §6
   components, §7 auth) in the same PR, and bump the "Last synced" date.

8. **Do not create new top-level Markdown/plan files.** Use in-repo docs
   (`CLAUDE.md`, `TECHNICAL_IMPLEMENTATION.md`) and JSDoc on modules.

9. **Confirm before you assume.** If any interface, copy, or business
   rule in this brief is ambiguous, stop and ask the user before
   guessing. A short checklist of likely ambiguities is at §19.

10. **Language of identifiers.** English only for code identifiers,
    table names, column names, API routes. Croatian only in user-facing
    strings (the `hr` locale bundle).

---

## 1. Locked technology choices

These are final. Do not substitute without prior approval.

| Concern | Choice | Notes |
|---|---|---|
| PDF generation | `pdf-lib` (`npm i pdf-lib`) | Receipts, evidence extracts, data-pack narrative PDFs |
| DOCX generation | `docx` (`npm i docx`) | Branded CSR report; same library already used in research tooling |
| Charts (server-side) | `vega-lite` → SVG → embed | For CSR reports and public profile; no canvas |
| Billing | Stripe Billing + Stripe Checkout + webhooks | Customer portal for self-serve upgrades |
| Email | Resend (`npm i resend`) | Transactional only; React Email templates |
| OIB lookup | Croatian sudski registar public endpoint | Fallback to OIB checksum validation (`mod 11,10`) if the registry is unreachable |
| Storage | Supabase Storage — private buckets `receipts`, `exports`, `reports`, `branding` | Signed URLs only; never public except for `reports` when `public_slug` is set |
| i18n | Lightweight in-repo solution under `src/i18n/` (no next-intl) | `hr.json`, `en.json`, `useT()` hook, `<LocaleSwitcher />` in `Navbar`. Default locale = `hr`. |
| Auth for companies | Existing Supabase auth + new role | SSO (WorkOS / Azure Entra) is Phase 4; do not ship it here |

---

## 2. Environment variables (add to `CLAUDE.md` §4 in Phase 0 PR)

| Name | Scope | Required | Used by |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | server | yes (Phase 1+) | `src/lib/stripe/server.ts` |
| `STRIPE_WEBHOOK_SECRET` | server | yes (Phase 1+) | `/api/stripe/webhook` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | public | yes | Checkout redirect |
| `STRIPE_PRICE_SME_TAX` | server | yes (Phase 1+) | Plan lookup table |
| `STRIPE_PRICE_SME_PLUS` | server | yes (Phase 1+) | Plan lookup table |
| `STRIPE_PRICE_ENTERPRISE` | server | yes (Phase 1+) | Plan lookup table |
| `RESEND_API_KEY` | server | yes | `src/lib/email/*` |
| `NEXT_PUBLIC_APP_URL` | public | yes | Absolute links in emails / receipts |
| `OIB_LOOKUP_URL` | server | no | Defaults to the public sudski registar endpoint in `src/lib/oib.ts` |
| `DEDUCTION_CEILING_PCT` | server | no | Defaults to `"2.0"`. Flip to `"4.0"` when the statutory change takes effect. |
| `AUTO_ACKNOWLEDGE_DAYS` | server | no | Defaults to `"14"`. |

All new env vars must be documented in `CLAUDE.md` §4 and must have safe
defaults or clear runtime errors if missing.

---

## 3. Domain model summary (read before migrations)

The new tenant type is **Company**. A company is distinct from an
institution:

- `institutions` are recipients of donations (shelters, Caritas, …).
- `companies` are *donor* corporate tenants.
- A user (`profiles`) can be:
  - a `citizen` with no tenant (current behaviour, unchanged);
  - an `institution` user, linked to one institution via `profiles.institution_id` (current behaviour, unchanged);
  - a `company` member, linked to one or more companies via
    `company_members`. A new role value `company` is added to the
    `user_role` enum, alongside existing `citizen` and `institution`.

Employee↔company linkage rules (implement exactly):

- A company admin verifies one or more email domains (DNS TXT record
  proof). Users registering from a verified domain are auto-linked as
  `employee`.
- A company admin can also issue invite tokens to specific email
  addresses (one-time, 14-day expiry). Accepting the invite links the
  user as `employee`.
- A company always has exactly one `owner` (the creator) and zero or
  more `admin`, `finance`, and `employee` members.
- A user can belong to multiple companies (gig workers, contractors).
  When a user has multiple company memberships, the company-scoped UI
  shows a company switcher.

Deduction-ceiling rule (Croatian Profit Tax Act):

- `DEDUCTION_CEILING_PCT` defaults to `2.0` and is flipped to `4.0` by
  env var when the law changes. The receipt renderer, the dashboard
  "headroom" widget, and the `companies.prior_year_revenue` field all
  reference `ceilingPct()` from `src/lib/tax.ts`.

Auto-acknowledge rule:

- When a pledge is marked `delivered` by the donor and the institution
  does not acknowledge within `AUTO_ACKNOWLEDGE_DAYS` (default 14), a
  scheduled job inserts a `pledge_acknowledgements` row with
  `kind = 'auto'`. Receipts render auto-acknowledged line items with a
  visible footnote `*auto-acknowledged after 14 days`.

---

## 4. Data model — migrations to ship

Create the migrations in order. Each file must be idempotent where
possible (`create table if not exists`, `create index if not exists`).
All new tables must have `created_at timestamptz default now()` and
`updated_at timestamptz default now()` with the existing `updated_at`
trigger applied.

### 4.1 Phase 0

`supabase/migrations/003_notifications_and_companies.sql`

- Create the `notifications` table that is currently referenced in code
  but missing from committed migrations. Use the shape implied by
  `src/lib/types.ts` (`Notification`) and `src/lib/notify-nearby.ts`.
  Minimum columns: `id uuid pk`, `user_id uuid fk auth.users`, `title
  text`, `body text`, `link text`, `read boolean default false`,
  `created_at timestamptz default now()`. RLS: user-scoped select/update.
  Update `CLAUDE.md` §5 note about `notifications` being missing.
- Create `user_role` additions: alter the existing text-based role
  column to add `company` as a valid value (if it is an enum, alter
  type; if it is a text check-constrained column, update the constraint).
- Create `companies`:
  - `id uuid pk`, `owner_id uuid fk auth.users`, `legal_name text not null`,
    `display_name text`, `slug text unique not null`, `oib char(11) unique`,
    `address text`, `city text`, `country char(2) default 'HR'`,
    `logo_url text`, `brand_primary_hex text`, `brand_secondary_hex text`,
    `size_class text check in ('micro','small','medium','large')`,
    `csrd_wave int check in (1,2,3)`,
    `prior_year_revenue_eur numeric(18,2)`,
    `default_match_ratio numeric(5,4) default 0`,
    `verified_at timestamptz`,
    `subscription_tier text default 'free' check in ('free','sme_tax','sme_plus','enterprise')`,
    `subscription_status text default 'inactive'`.
- Create `company_members`: `id uuid pk`, `company_id uuid fk companies`,
  `profile_id uuid fk profiles`, `role text check in ('owner','admin','finance','employee')`,
  `department text`, `joined_at timestamptz default now()`, unique
  `(company_id, profile_id)`.
- Create `company_domains`: `id uuid pk`, `company_id uuid fk companies`,
  `domain text not null`, `verified_at timestamptz`, `dns_token text
  not null`, unique `(domain)`.
- Create `company_invites`: `id uuid pk`, `company_id uuid fk companies`,
  `email text not null`, `role text`, `token text unique not null`,
  `expires_at timestamptz not null`, `accepted_at timestamptz`,
  `invited_by uuid fk profiles`.
- Create `campaigns`: `id uuid pk`, `company_id uuid fk companies`,
  `name text not null`, `slug text not null`, `description text`,
  `starts_at timestamptz`, `ends_at timestamptz`,
  `target_amount_eur numeric(18,2)`, `sdg_tags int[] default '{}'`,
  `theme text`, unique `(company_id, slug)`.
- Alter `pledges`: add `company_id uuid null fk companies`,
  `campaign_id uuid null fk campaigns`, `match_of_pledge_id uuid null
  fk pledges`, `tax_category text default 'humanitarian'`,
  `fulfilled_at timestamptz null`.
- Alter `volunteer_signups`: add `checked_in_at timestamptz`,
  `checked_out_at timestamptz`, `company_id uuid null fk companies`.
- Create `audit_log`: append-only table. Columns: `id bigserial pk`,
  `actor_profile_id uuid`, `company_id uuid`, `action text not null`,
  `entity_type text`, `entity_id uuid`, `payload jsonb`, `prev_hash text`,
  `hash text`, `created_at timestamptz default now()`. Function
  `audit_log_chain()` computes `hash = sha256(prev_hash || payload || created_at)`.

RLS policies — enumerate explicitly in the migration:

- `companies`: public `select` of id/display_name/slug/logo_url/brand_* only;
  full `select` for members; `insert` by any authenticated user (creates
  owner row); `update` by owner/admin.
- `company_members`: members see each other within the same company;
  owner/admin can insert/delete except self.
- `company_domains`, `company_invites`: owner/admin scoped.
- `campaigns`: public `select` for active campaigns; member write.
- `pledges` changes: existing policies preserved; add a policy that
  company members can `select` pledges where `pledges.company_id` matches
  any of their memberships.
- `audit_log`: insert by service role only (the `supabaseAdmin` client
  inside server route handlers). Read by the same.

### 4.2 Phase 1

`supabase/migrations/004_evidence_and_receipts.sql`

- Create `pledge_acknowledgements`: `id uuid pk`, `pledge_id uuid fk
  pledges unique`, `institution_user_id uuid fk profiles`,
  `signed_at timestamptz default now()`, `kind text check in ('manual','auto') default 'manual'`,
  `notes text`, `delivery_photo_url text`, `signature_hash text not null`.
  RLS: institution users insert where they belong to the
  `pledges.institution_id`; donors and company members of
  `pledges.company_id` can read.
- Create `donation_receipts`: `id uuid pk`, `company_id uuid fk
  companies`, `fiscal_year int not null`, `version int default 1`,
  `generated_at timestamptz default now()`, `pdf_url text`,
  `xml_url text`, `total_amount_eur numeric(18,2)`,
  `ceiling_pct numeric(5,2)`, `ceiling_consumed_pct numeric(7,4)`,
  `manifest_jsonb jsonb`. Unique `(company_id, fiscal_year, version)`.
  RLS: company admins/finance only.
- Storage buckets: create private `receipts` bucket via migration or a
  one-time admin script with an RLS policy gating by
  `(storage.foldername(name))[1] = auth.uid()::text` pattern adjusted for
  company ownership.

### 4.3 Phase 2

`supabase/migrations/005_esg_exports.sql`

- Create `esg_exports`: `id uuid pk`, `company_id uuid fk companies`,
  `framework text check in ('vsme_basic','vsme_comp','esrs_s1','esrs_s3','gri_413','b4si')`,
  `period_start date not null`, `period_end date not null`,
  `file_url text`, `manifest_jsonb jsonb`,
  `generated_at timestamptz default now()`, `version int default 1`.
  Unique `(company_id, framework, period_start, period_end, version)`.
- Create `volunteer_hours`: denormalised rollup table; one row per
  (signup, check-in session). Columns: `id uuid pk`,
  `volunteer_signup_id uuid fk volunteer_signups`, `user_id uuid`,
  `institution_id uuid`, `company_id uuid null`, `hours numeric(6,2) not null`,
  `recorded_by uuid`, `recorded_at timestamptz default now()`.

### 4.4 Phase 3

`supabase/migrations/006_reports_and_profiles.sql`

- Create `csr_reports`: `id uuid pk`, `company_id uuid fk companies`,
  `period_start date`, `period_end date`, `template_id text default 'default'`,
  `pdf_url text`, `docx_url text`, `public_slug text unique`,
  `generated_at timestamptz default now()`. When `public_slug` is
  non-null, the report is listed on the public profile.
- Alter `companies`: add `public_profile_enabled boolean default false`,
  `tagline text`, `social jsonb default '{}'` (map of social handles).

### 4.5 Billing (cross-phase — land in Phase 1)

`supabase/migrations/007_billing.sql`

- `subscriptions`: `id uuid pk`, `company_id uuid fk companies unique`,
  `stripe_customer_id text`, `stripe_subscription_id text`,
  `tier text`, `status text`, `current_period_end timestamptz`,
  `cancel_at timestamptz`, `raw jsonb`.
- `stripe_events`: idempotency log for the webhook. `id text pk`
  (Stripe event id), `processed_at timestamptz default now()`, `type text`,
  `payload jsonb`.

---

## 5. Types, constants, framework manifests

### 5.1 `src/lib/types.ts`

Add: `Company`, `CompanyMember`, `CompanyRole`, `CompanyDomain`,
`CompanyInvite`, `Campaign`, `PledgeAcknowledgement`, `VolunteerHours`,
`DonationReceipt`, `EsgExport`, `CsrReport`, `Subscription`, `Framework`,
extended `Pledge` (with `company_id?`, `campaign_id?`, etc.),
`TaxCategory` union.

### 5.2 `src/lib/constants.ts`

Add `TAX_CATEGORIES` (seven Profit Tax Act categories: cultural,
scientific, educational, health, humanitarian, sports, religious,
environmental, other public-benefit), `SDG_GOALS` (17 entries with
Croatian + English labels and colours per the official UN palette),
`SUBSCRIPTION_TIERS` with feature flags per tier, `SIZE_CLASSES`,
`CSRD_WAVES`.

### 5.3 `src/lib/tax.ts`

- `ceilingPct()` → number, reads `DEDUCTION_CEILING_PCT` env, clamps to [0, 100].
- `headroomEur(priorYearRevenueEur: number)` → number.
- `consumedPct(totalGivenEur: number, priorYearRevenueEur: number)` → number.
- `isWithinCeiling(totalGivenEur, priorYearRevenueEur)` → boolean.

### 5.4 `src/lib/oib.ts`

- `isValidOib(oib: string)` → boolean (mod 11,10 checksum; must be 11 digits).
- `lookupOib(oib: string)` → `{ legalName, address, city, isActive } | null`.
  Calls `OIB_LOOKUP_URL` (default: sudski registar public endpoint),
  with a 3s timeout; falls back to format-only validation.

### 5.5 Framework manifests — `src/lib/frameworks/`

Each framework is a JSON manifest + a TypeScript compiler:

```
src/lib/frameworks/
  vsme-basic.json        // datapoint definitions
  vsme-comp.json
  esrs-s1.json
  esrs-s3.json
  gri-413.json
  b4si.json
  compile.ts             // runs a manifest against a company + period
  types.ts               // DatapointSpec, DatapointResult, EvidenceRef
```

Manifest schema (each entry):

```jsonc
{
  "id": "B1-employees-volunteer-hours",
  "framework": "vsme_basic",
  "label_en": "Total employee volunteer hours (company-supported)",
  "label_hr": "Ukupan broj sati volontiranja zaposlenika",
  "unit": "hours",
  "sourceSql": "select coalesce(sum(hours),0) as value from volunteer_hours where company_id = :company_id and recorded_at between :from and :to",
  "evidenceQuery": "select id from volunteer_hours where company_id = :company_id and recorded_at between :from and :to",
  "required": true,
  "maps_to": { "esrs": ["S1-14"], "gri": ["GRI 401-2"], "b4si": ["Inputs.Time"] }
}
```

Ship **all** manifests but flag each datapoint `implemented: true|false`.
Unimplemented datapoints produce a skip-code and a human-readable reason
in the export manifest (so auditors see the gap explicitly).

---

## 6. Phase 0 — Foundations (PR #1)

### 6.1 Deliverables

1. Migrations in §4.1.
2. `src/lib/supabase/types.ts` regenerated if you use Supabase codegen.
3. `src/lib/i18n/` module with `hr.json` and `en.json` containing all
   new strings. Server helper `t(key, locale)` + client hook `useT()`.
4. `<LocaleSwitcher />` added to `Navbar.tsx`. Locale stored in cookie
   `locale` (HR default).
5. Company onboarding flow:
   - `/auth/register` gains a third role tile: "Company".
   - `/dashboard/company/new`: stepper (OIB + legal name → address →
     logo + brand colours → invite first teammates). OIB is validated
     via `lookupOib`, auto-fills legal name and address.
   - After creation, redirect to `/dashboard/company` (the tenant home).
6. Company tenant dashboard skeleton:
   - `/dashboard/company` summary (giving headroom, employees count,
     active campaigns).
   - `/dashboard/company/team` member list, invite form, domain
     verification flow (generates a `dns_token`, shows DNS TXT
     instructions, verifies by polling).
   - `/dashboard/company/campaigns` list + create/edit form.
   - `/dashboard/company/settings` company profile, brand, prior-year
     revenue (required for the receipt), billing tab (stub in Phase 0).
7. Company switcher in `Navbar.tsx` when the user has >1 membership.
8. Pledge flow extension: on a need, a user who is a company member can
   choose "Pledge on behalf of <Company>" with an optional "request
   company match" checkbox (match only fires when the company has
   `default_match_ratio > 0`). The resulting API call sets
   `pledges.company_id` and optionally inserts the match pledge server-side.
9. `src/lib/audit.ts` helper; every mutating company-scoped API route
   writes to `audit_log` via `supabaseAdmin`.
10. Fix the three bugs in `CLAUDE.md` §9 that touch files modified here.
11. Update `CLAUDE.md` §3, §4, §5, §6, §7, §9.

### 6.2 API routes

Prefix: `/api/companies`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/companies` | authed | Create company + first `owner` member; validates OIB |
| GET | `/api/companies/[id]` | member | Profile for the company switcher |
| PATCH | `/api/companies/[id]` | owner/admin | Update profile, brand, revenue, match ratio |
| POST | `/api/companies/[id]/domains` | owner/admin | Start domain verification |
| POST | `/api/companies/[id]/domains/[domainId]/verify` | owner/admin | Poll DNS for the TXT record |
| POST | `/api/companies/[id]/invites` | owner/admin | Create invite token + Resend email |
| POST | `/api/companies/invite/accept` | authed | Accept invite by token |
| GET | `/api/companies/[id]/members` | member | List members |
| DELETE | `/api/companies/[id]/members/[profileId]` | owner/admin | Remove member |
| POST | `/api/companies/[id]/campaigns` | owner/admin | Create campaign |
| GET | `/api/companies/[id]/campaigns` | member | List campaigns |
| PATCH | `/api/campaigns/[id]` | owner/admin | Update campaign |

Extend existing:

- `POST /api/pledges` accepts optional `{ company_id, campaign_id,
  request_match }`. Validates the caller is a member of the company;
  inserts the match pledge if applicable.

### 6.3 UI copy

All new strings go through `t()`. Provide Croatian first, English second.
No hard-coded Croatian strings in TSX; no hard-coded English strings
outside `en.json`.

### 6.4 Acceptance checklist (Phase 0)

- [ ] New user can register as a Company and land on a working tenant dashboard.
- [ ] OIB validation and lookup both work; invalid OIBs are rejected with a clear error in both locales.
- [ ] An employee invite email is sent via Resend and the link completes the join flow.
- [ ] Domain verification works end-to-end with a live DNS TXT record.
- [ ] A citizen pledge on behalf of their company is visible on the company dashboard.
- [ ] `/map`, `/needs`, `/volunteer`, existing citizen and institution dashboards are unchanged.
- [ ] `AccessibilityMenu` still works on every new page.
- [ ] `npm run build && npm run lint` are clean.
- [ ] `CLAUDE.md` is updated with the new layout, env vars, data model, components, auth notes, and the bug-fix status in §9.

---

## 7. Phase 1 — Tax receipts (PR #2)

### 7.1 Deliverables

1. Migration `004_evidence_and_receipts.sql` and `007_billing.sql`.
2. Institution-side acknowledgement UX:
   - In `/dashboard/institution/pledges` (or wherever delivered pledges
     appear), add an "Acknowledge delivery" button on each delivered
     pledge. Opens a dialog with optional notes and photo upload
     (Supabase Storage bucket `receipts/evidence`).
   - On submit, POST `/api/pledges/[id]/acknowledge`. Server writes
     `pledge_acknowledgements` with `kind='manual'` and a
     `signature_hash = sha256(pledge_id||institution_user_id||signed_at||notes)`.
3. Scheduled auto-acknowledge:
   - A Vercel Cron (or Supabase pg_cron if available) job at
     `/api/cron/auto-acknowledge` runs daily. Inserts `kind='auto'`
     acknowledgements for pledges in status `delivered` older than
     `AUTO_ACKNOWLEDGE_DAYS`.
4. Fiscal-year receipt generator:
   - `src/lib/receipts/render.ts` — produces a PDF using `pdf-lib`
     laid out as: letterhead with company brand, donor block (legal
     name, OIB, address), fiscal year, deduction ceiling used
     (`ceilingPct`), consumed %, line-item table (date, institution,
     OIB of institution, category, amount EUR, kind=manual|auto),
     signed verification appendix (one page per acknowledged pledge).
   - Also emits an XML manifest at `receipts/{company_id}/{fy}.xml`
     structured for Porezna uprava audit trail.
5. Billing:
   - `src/lib/stripe/server.ts` — Stripe client. Tier → priceId lookup
     uses the env vars.
   - `POST /api/billing/checkout` — creates a Stripe Checkout session
     for the selected tier; redirects to the customer portal.
   - `POST /api/stripe/webhook` — handles `checkout.session.completed`,
     `customer.subscription.updated`, `customer.subscription.deleted`.
     Idempotent via `stripe_events` table.
   - Tier-gating middleware `src/lib/billing/gate.ts` throws 402 when
     the calling company's tier lacks the requested feature.
6. Company dashboard additions:
   - Headroom widget (EUR remaining / % consumed).
   - Receipts list with "Generate" and "Download" buttons.
   - Billing tab goes live (plan picker, payment method, portal link).

### 7.2 API routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/pledges/[id]/acknowledge` | institution member of recipient | Manual acknowledgement |
| POST | `/api/cron/auto-acknowledge` | Vercel Cron header | Auto-ack sweep |
| POST | `/api/companies/[id]/receipts` | admin/finance | Generate receipt for FY |
| GET | `/api/companies/[id]/receipts` | admin/finance | List receipts |
| GET | `/api/companies/[id]/receipts/[receiptId]/download` | admin/finance | Signed URL to PDF/XML |
| POST | `/api/billing/checkout` | owner/admin | Stripe Checkout session |
| POST | `/api/billing/portal` | owner/admin | Stripe billing portal |
| POST | `/api/stripe/webhook` | Stripe signature only | Webhook handler |

### 7.3 Emails (Resend)

Templates live in `src/lib/email/templates/`:

- `invite.tsx` (Phase 0)
- `acknowledgement-nudge.tsx` (Phase 1) — to institutions with pledges ageing past day 7 and day 12.
- `receipt-ready.tsx` (Phase 1) — to the company finance contact when a receipt is generated.
- `payment-failed.tsx` (Phase 1)

All emails bilingual; locale read from the recipient's `profiles.locale`.

### 7.4 Acceptance checklist (Phase 1)

- [ ] Institution can acknowledge a delivered pledge in one click and the acknowledgement shows on the donor's dashboard.
- [ ] The cron job auto-acknowledges pledges older than 14 days and the receipt renders these with a clearly visible footnote.
- [ ] Fiscal-year receipt PDF renders correctly for a company with sample pledges spanning multiple institutions; OIBs, amounts, and ceiling percentages are accurate.
- [ ] Stripe checkout flow upgrades a company from Free to `sme_tax` and back via the portal; webhook correctly updates `subscriptions` and `companies.subscription_tier`.
- [ ] Tier gating denies receipt generation on Free but allows it on `sme_tax+`.
- [ ] All new env vars documented in `CLAUDE.md` §4.
- [ ] Known bugs in `CLAUDE.md` §9 touched by these files are fixed.

---

## 8. Phase 2 — ESG exports (PR #3)

### 8.1 Deliverables

1. Migration `005_esg_exports.sql`.
2. Framework manifests under `src/lib/frameworks/` for: `vsme_basic`,
   `vsme_comp`, `esrs_s1`, `esrs_s3`, `gri_413`, `b4si`.
3. `src/lib/frameworks/compile.ts` — takes `(companyId, framework, period)`,
   executes each datapoint's `sourceSql` and `evidenceQuery`, returns a
   `DatapointResult[]` with `{ id, value, unit, evidence: EvidenceRef[], skipReason? }`.
4. Export packager — `src/lib/exports/pack.ts` — produces a single ZIP:
   - `data.csv`, `data.json`, `manifest.json` (list + hashes),
     `narrative.pdf` (pdf-lib), `evidence/<datapoint-id>/<n>.pdf` files.
   - Narrative PDF format: one page summary, per-datapoint section with
     value + source rows count + evidence list.
5. Volunteer-hours capture:
   - Extend `/dashboard/institution` to allow recording check-in /
     check-out for volunteer events. On check-out, insert a
     `volunteer_hours` row computed as `(checked_out_at - checked_in_at)`.
   - Self-service check-in for volunteers via a QR code on the event
     detail page.
6. Company dashboard Exports tab:
   - Lists historic exports; "Generate new" dialog picks framework +
     period. Generates server-side, uploads to `exports/` bucket,
     returns signed URL.
7. Tier gating:
   - `sme_plus`: `vsme_basic` only.
   - `enterprise`: all frameworks.

### 8.2 API routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/companies/[id]/exports` | admin/finance, tier-gated | Generate export (async ok) |
| GET | `/api/companies/[id]/exports` | admin/finance | List exports |
| GET | `/api/companies/[id]/exports/[exportId]/download` | admin/finance | Signed ZIP URL |
| POST | `/api/volunteer-signups/[id]/check-in` | institution user | Record check-in |
| POST | `/api/volunteer-signups/[id]/check-out` | institution user | Record check-out + hours row |

### 8.3 Acceptance checklist (Phase 2)

- [ ] Running a VSME Basic export for a company with the sample pledges and volunteer hours produces a valid ZIP whose CSV opens cleanly in Excel and whose `manifest.json` hashes match the files.
- [ ] Each datapoint row in the export links to at least one evidence file when data exists, and carries a `skipReason` otherwise.
- [ ] Enterprise-tier company can generate all six framework exports; `sme_plus` is limited to VSME Basic; Free is blocked.
- [ ] Volunteer hour capture round-trip works: event → QR check-in → check-out → row in `volunteer_hours` → count in next export.

---

## 9. Phase 3 — Branded CSR report + public profile (PR #4)

### 9.1 Deliverables

1. Migration `006_reports_and_profiles.sql`.
2. CSR report renderer `src/lib/csr-report/render.ts`:
   - Uses the `docx` library (for DOCX) and `pdf-lib` (for PDF) from
     the same input tree.
   - Template structure: cover (logo + tagline), exec summary (auto-
     written from stats), giving over time chart (SVG from vega-lite),
     top beneficiaries, SDG breakdown, two beneficiary stories (pulled
     from highest-amount acknowledged pledges, text lifted from the
     institution's description), methodology appendix.
3. Public profile page:
   - `/company/[slug]` — server component. Shows display_name, tagline,
     logo, brand-tinted header, verified metrics (total given, hours
     volunteered, institutions supported, SDG chips), campaign list,
     latest report download link, open-graph meta + twitter card.
   - Gated by `companies.public_profile_enabled = true` and by a
     valid tier (`sme_plus+`).
4. Embed widget:
   - `/company/[slug]/embed.js` serves a small script that renders a
     static metrics card on a third-party site.
5. Social share cards:
   - `/api/og/company/[slug]` renders an OG image via `@vercel/og`
     (permitted lightweight dep since it's on-brand with Next 15).

### 9.2 Acceptance checklist (Phase 3)

- [ ] A company admin can generate a CSR report for the last 12 months; the PDF and DOCX are coherent, branded, and download from signed URLs.
- [ ] `/company/[slug]` renders for a published profile with correct metrics; returns 404 when disabled.
- [ ] OG image renders with the company logo and the headline metric.
- [ ] Embed script drops a card on a blank HTML page and respects `prefers-color-scheme`.

---

## 10. Cross-cutting requirements

### 10.1 Testing

- `npm i -D vitest @vitest/ui`. Add `vitest` script to `package.json`.
- Unit tests at least for: `isValidOib`, `ceilingPct` / `headroomEur`,
  `compile.ts` per framework (snapshot a small fixture), the receipt
  renderer (hash-stable output), the webhook idempotency path.
- One Playwright smoke test per phase in `tests/e2e/` covering the
  critical happy path. If Playwright is not already set up, install it
  in Phase 0 and wire a minimal config (`tests/e2e/playwright.config.ts`).

### 10.2 Observability

- `src/lib/log.ts` — single structured logger used across route
  handlers. No `console.log` in production code paths; use
  `log.info`/`log.error` which prefix module and trace id.
- Log all Stripe webhook events and all export generations.

### 10.3 Security

- CSRF: Next.js App Router route handlers are CSRF-safe by default for
  cross-site POST only when cookies are `SameSite=lax`. Verify the
  Supabase `sb-*` cookies ship with `SameSite=lax` and add a `Origin`
  check on all mutating company routes.
- Webhook signature verification for Stripe is mandatory; fail closed.
- Rate-limit OIB lookup (in-memory sliding window per IP for MVP).
- Log every `audit_log` write with an advisory lock to prevent hash-chain races.

### 10.4 Performance & cost

- Keep receipt and export generation under 10s on Vercel. If a single
  run exceeds this, switch to the Supabase Queues pattern (or insert a
  row into `jobs` and poll).
- Use signed URLs with 15-minute TTL; do not embed signed URLs in emails
  — email the in-app link which re-issues the URL.

### 10.5 Accessibility

- Every new page must pass `axe-core` smoke check. Dialogs use
  `role="dialog" aria-modal="true"` and focus trap per existing
  `AccessibilityMenu` pattern.
- Bilingual labels on every icon button; real `<button>`, no
  `<div onClick>`.

### 10.6 i18n implementation detail

- `src/i18n/hr.json` is the source of truth; keys added in English are
  blocked on the Croatian translation existing.
- Locale persisted in a `locale` cookie (read by Server Components) +
  propagated to the client via `layout.tsx`.
- Dates formatted with `date-fns/locale/hr` when locale is HR.
- Currency formatted as `Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR' })`.

---

## 11. Documentation updates to ship in each PR

- `CLAUDE.md`:
  - §2 Tech stack — add `pdf-lib`, `docx`, `resend`, `stripe`, `@vercel/og`.
  - §3 Directory layout — add `src/i18n/`, `src/lib/frameworks/`,
    `src/lib/stripe/`, `src/lib/email/`, `src/lib/receipts/`,
    `src/lib/csr-report/`, `src/app/dashboard/company/`,
    `src/app/company/[slug]/`, `supabase/migrations/003–007`.
  - §4 Env vars — append the new block from §2 of this brief.
  - §5 Data model — extend table list, note the new role,
    mention the `notifications` migration now being in-tree.
  - §6 Components — add `LocaleSwitcher`, `CompanySwitcher`,
    `AcknowledgeDialog`, `HeadroomWidget`, `ReceiptPreview`,
    `FrameworkPicker`, `PublicProfileHeader`.
  - §7 Auth — document `company` role, company memberships, invite
    flow, domain verification.
  - §9 Known issues — update status of the three bugs and the
    `notifications` table.
  - §10 Dev workflow — add `npm run test`, `npm run test:e2e`.
  - Bump "Last synced" date in every PR.

- `TECHNICAL_IMPLEMENTATION.md`:
  - Append sections for company tenants, receipts, ESG exports, reports.

---

## 12. Prohibited actions

- No changes to the root redirect `/ → /map`.
- No changes to the citizen or institution dashboards beyond those
  required for acknowledgement (Phase 1) and volunteer hour capture
  (Phase 2).
- No changes to the map view or the filter bar behaviour.
- No new npm dependency outside the locked list in §1 without user
  approval — specifically, no new state management, no new CSS
  framework, no new ORM.
- No destructive SQL in any migration (no `drop`, no `alter column
  type` that loses data).
- No storing Stripe secrets, OIB lookup responses, or PII in logs.
- No server-rendered HTML → PDF via headless Chromium on Vercel.
- No top-level new Markdown/plan files.

---

## 13. PR description template (use for every phase)

```
## Summary
- Phase N: <title>
- <1-2 bullets of what ships>

## Data model
- <list migrations>

## API
- <list routes added/changed>

## UI
- <list pages/components added>

## Migrations run locally
- [ ] `supabase db reset` succeeds
- [ ] Seed script still seeds cleanly

## Verification
- [ ] `npm run build`
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run test:e2e` (phase smoke)
- [ ] Accessibility menu works on new pages
- [ ] CLAUDE.md updated (§3/§4/§5/§6/§7/§9)
- [ ] Known-bugs status refreshed

## Out of scope for this PR
- <later phases>
```

---

## 14. Seed / fixtures

- Extend `scripts/seed.mjs` with optional `--with-esg` flag that creates:
  - 2 demo companies (one `sme_tax`, one `enterprise`),
  - 5 employees each (with bilingual `locale` cookie variations),
  - 2 campaigns per company,
  - 30 pledges across campaigns against existing seeded institutions,
  - 80% acknowledged manually, 20% auto-acknowledged,
  - 40 volunteer-signup rows with check-in/check-out times.

Do not overwrite production data. The flag must be a no-op unless
explicitly passed, and must be guarded by `NODE_ENV !== 'production'`.

---

## 15. Rollout and feature flags

Introduce a simple feature-flag mechanism in `src/lib/flags.ts`:

- `FLAG_COMPANIES_ENABLED` (default on after Phase 0)
- `FLAG_RECEIPTS_ENABLED` (default off until Phase 1 tax opinion is in)
- `FLAG_EXPORTS_ENABLED` (default off until Phase 2)
- `FLAG_PUBLIC_PROFILE_ENABLED` (default off until Phase 3)

Flags are read from env vars (`NEXT_PUBLIC_FLAG_*`) with sane defaults.
All new UI entries are gated behind the relevant flag.

---

## 16. Compliance and copy

- Tax receipt copy must be reviewed with a Croatian tax advisor before
  `FLAG_RECEIPTS_ENABLED` flips on in production. The PR must include a
  TODO comment at the top of `src/lib/receipts/render.ts` pointing to
  this requirement.
- The Privacy Policy and Terms of Service are out of scope for this
  brief; Claude Code must surface in the final Phase 1 PR description
  that the user needs to publish these before receipts ship to customers.

---

## 17. Open questions Claude Code must confirm before starting

Stop and ask the user about each of the following *before* writing code
if the answer is not inferable from the repo:

1. Exact copy for the three corporate onboarding steps in Croatian
   (company name, OIB, address) — ship a draft but flag for review.
2. Brand colours for the default DajSrce receipt letterhead.
3. Whether the company-switcher should appear on mobile too
   (recommended: yes, as a compact avatar stack).
4. Stripe price IDs to populate `STRIPE_PRICE_*` env vars — user must
   create these in Stripe and supply IDs before Phase 1 ships.
5. Whether to restrict institution types eligible to appear on tax
   receipts (e.g. only institutions whose category matches the seven
   Profit Tax Act categories) — default yes, confirm before enforcing.
6. Fiscal-year alignment — default is calendar year; confirm whether any
   Croatian corporate uses a non-calendar fiscal year that the product
   must support from day one.
7. Effective date of the 2% → 4% deduction change — used only to plan
   the config flip, not to block shipping.
8. Whether to mirror the `institution` side with a "verified by
   DajSrce" badge shown on receipts (useful for auditor confidence).

---

## 18. Definition of done (program level)

After all four PRs merge:

- A Croatian SME can register a Company, verify their domain, invite
  employees, run a Christmas food-drive campaign, collect pledges from
  employees with matching, receive signed institution acknowledgements,
  download an audit-ready tax-receipt PDF + XML, generate a VSME Basic
  export ZIP, publish a branded CSR report, and expose a verified
  public impact profile at `/company/my-slug` — all in one locale
  switch, with no public-site regressions, passing lint, build, tests,
  and accessibility checks.
- `CLAUDE.md` reflects the new reality end-to-end.
- All three legacy bugs in `CLAUDE.md` §9 are resolved.
- The `notifications` table is in-tree via a committed migration.

---

*End of brief. If any instruction here conflicts with what you
discover in the repo, stop and surface the conflict before acting.*
