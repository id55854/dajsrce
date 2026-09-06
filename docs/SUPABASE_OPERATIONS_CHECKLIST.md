# Supabase operations checklist (dashboard-side work)

Everything here lives in the Supabase project, not in this repository. It is
the list of things a release owner must do or confirm by hand, with what was
verified on 2026-09-06 and how.

Project: `wbxvpdbhddespdsscsnw` (eu-west-1). Read-only verification below used
the Management API `POST /v1/projects/{ref}/database/query` with
`SUPABASE_ACCESS_TOKEN` from `.env.local`.

## 1. Auth password and sign-up hardening

See `AUTH_PASSWORD_OPERATIONS.md`. Live values on 2026-09-06: minimum length
6, leaked-password protection off, e-mail auto-confirm on, CAPTCHA off. The
exact `PATCH` call is in that document. **Not applied**; it changes account
behaviour and belongs to the release owner.

## 2. MFA

- **Supabase account (dashboard login):** Account → Security → enable MFA for
  every person with project access. Cannot be verified from code.
- **Application users:** TOTP enrol/verify are already *enabled* on the
  project (`mfa_totp_enroll_enabled = true`), but the app has no enrolment or
  challenge screens and no `aal2` gate on privileged routes. Treat as unbuilt.

## 3. Backups

Dashboard → Database → Backups.

- Confirm daily backups are listed and recent.
- Point-in-Time Recovery is a paid add-on; enable it before the platform holds
  data people would miss.
- Restore one backup into a scratch project and run `npm run registry:verify`
  against it before launch. The runbook in `TECHNICAL_IMPLEMENTATION.md`
  expects this before every release.
- Backups do not include Storage objects. Registry snapshot files are
  re-creatable from `registry:sync`; nothing else user-visible lives in
  Storage today.

## 4. Monitoring

Dashboard → Logs and Reports: API errors, Auth errors, Postgres errors, 5xx.

Application-side, every route logs one JSON line per failure through
`src/lib/observability.ts` (`event`, `request_id`, `error_name`, optional
Postgres `code`; never the message). Search Vercel logs by `request_id`; the
same id is returned to the client in the `x-request-id` header and the JSON
body. Rate-limit rejections are `429` with `Retry-After`.

Worth a drain or alert once traffic is real: `dead` rows in
`notification_jobs`, failed artifact generations, and any `public_map_*_failed`
event, which means the home page could not draw.

## 5. Storage buckets

Dashboard → Storage → Buckets and → Policies.

- Registry snapshot storage is service-role only and reclaimed by
  `npm run registry:reclaim`.
- No bucket should be public unless every object in it is safe for the open
  internet. Verify by hand; bucket ACLs are not visible through the SQL API
  used for the checks below.

## 6. RLS and grants (verified 2026-09-06)

| Table | RLS | Read policy | Notes |
| --- | --- | --- | --- |
| `needs` | on | everyone | public list, served via anon client + CDN |
| `volunteer_events` | on | everyone | public list, served via anon client + CDN |
| `institutions` | on | everyone | anon sees 61 of 76 columns; exact private coordinates are not among them |
| `profiles` | on | policy-scoped | |
| `pledges`, `volunteer_signups` | on | policy-scoped | mutated only through service-role RPCs |
| `audit_log` | on | **none** | `SELECT` revoked from `anon`/`authenticated` in `20260906120000_audit_transaction_coverage.sql` |
| `registry_publication_state` | on | | |

All ten pledge/volunteer transaction RPCs are `SECURITY DEFINER`, execute is
granted to `service_role` only, and since 2026-09-06 each appends a
hash-chained `audit_log` event (28 rows existed before; the chain continues
from them).

Default Supabase grants leave `REFERENCES, TRIGGER, TRUNCATE` on public tables
for `anon`/`authenticated`. PostgREST exposes none of those verbs, so they are
inert, but a future migration that tightens table grants across the board
would be a reasonable hardening step.

## 7. Rate limits

Application-level limits (per client address, per instance, in memory) now
cover every API route: sign-up/claim flows, pledges, needs, events, check-in
token issuance, notifications, `/api/me` and all public `v1` endpoints. They
bound abuse of one serverless instance; Supabase's own Auth rate limits
(`rate_limit_email_sent = 2/h` etc.) and the Vercel firewall remain the
platform-level backstop.
