# Supabase Auth settings the release owner must enable

**Status: NOT APPLIED.** Everything below is a provider/dashboard setting, not
application code. It was deliberately left out of the code change because
faking it in the client would be security theatre; the client can be bypassed
entirely by calling the Supabase Auth API directly. The exception is section
3: two-step sign-in (TOTP) is built and enforced in the application since
2026-09-28, and needs only the TOTP settings confirmed.

## Live values, read from the project on 2026-09-06

Read through the Management API (`GET /v1/projects/{ref}/config/auth`), not
from memory. Project `wbxvpdbhddespdsscsnw`.

| Setting | Live value | Target | Section |
| --- | --- | --- | --- |
| `password_min_length` | `6` | `12` | 1 |
| `password_hibp_enabled` | `false` | `true` | 2 |
| `password_required_characters` | none | none (deliberate) | 1 |
| `mailer_autoconfirm` | `true` (e-mail confirmation OFF) | `false` | 4 |
| `security_captcha_enabled` | `false` | decide (hCaptcha/Turnstile) | 4 |
| `mfa_totp_enroll_enabled` / `mfa_totp_verify_enabled` | `true` | keep both on: the app's two-step sign-in needs them | 3 |
| JWT signing key | ES256 in use, HS256 previously used | keep asymmetric | note below |

The three rows marked as gaps can be closed in one call, from a shell that has
`SUPABASE_ACCESS_TOKEN` (the same token `.env.local` already holds):

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/wbxvpdbhddespdsscsnw/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password_min_length":12,"password_hibp_enabled":true,"mailer_autoconfirm":false}'
```

Turning `mailer_autoconfirm` off is a product change as well as a security one:
new e-mail/password accounts must click the confirmation link before their
first sign-in. The register page already sends `emailRedirectTo` to
`/auth/callback`, so the flow exists; test it on staging first and drop that
key from the payload if you want the two password settings alone.

**Signing key note.** Because the in-use key is asymmetric (ES256), the
application verifies session JWTs locally on read-only paths
(`src/lib/auth/claims.ts`) instead of calling Supabase Auth on every request.
Do not roll the project back to a symmetric (HS256) key without reading that
file: the code still works (it falls back to a network check), but the
performance reason for it disappears.

## Background: why there is no "AES for passwords" item here

The original request was to "switch passwords to a standard like AES". That is
a category error and was corrected before that work started:

- AES is **reversible encryption**. Anything encrypted with AES can be
  decrypted with the key, so a stolen database plus a stolen key returns every
  password in plaintext. Password storage requires a **one-way, deliberately
  slow hash**, not a cipher.
- Supabase Auth (GoTrue) already stores passwords as **bcrypt** hashes in
  `auth.users.encrypted_password`. That is the correct standard and it is not
  ours to change.
- This application never sees, transports or stores a password hash. The
  browser hands the password straight to Supabase Auth over TLS.

So there was nothing to fix in hashing. What *was* weak; a 6-character
minimum, no strength feedback, no rejection of guessable passwords, has been
fixed in code. What remains is the provider configuration below.

---

## 1. Minimum password length parity (do this first: it is the real gate)

**What:** raise the server-side minimum from the Supabase default of `6` to
`12`, matching `MIN_PASSWORD_LENGTH` in `src/app/auth/auth-validation.ts`.

**Where:** Supabase Dashboard → your project → **Authentication** → **Sign In /
Up** (older dashboard builds: **Authentication → Providers → Email**) →
**Minimum password length** → set to `12` → Save.

Equivalent non-UI paths, if you prefer them:

- Management API: `PATCH /v1/projects/{ref}/config/auth` with
  `{ "password_min_length": 12 }`.
- Local/CI (`supabase/config.toml`): `[auth] minimum_password_length = 12`.

**Why it matters:** the 12-character rule in the application is *client-side
only*. A script that POSTs to `/auth/v1/signup` never runs our React form, so
until the project setting is raised, six-character passwords are still
creatable. The client rules improve the experience of choosing a good password;
this setting is what actually enforces it.

**Expected side effect:** when the project minimum is raised, GoTrue rejects
short passwords with the `weak_password` error code. That is already mapped
`authErrorKey` in `src/app/auth/auth-validation.ts` turns it into
`auth.error_weak_password`, which reads in the same voice as the client-side
messages.

**Not a lockout:** the minimum applies to *setting* a password (sign-up,
password reset, password change). Existing users keep signing in with the
password they already have, however short it is. Do not add any length check
to the sign-in path.

**Optional, decide deliberately:** the same screen offers **Password
Requirements** (e.g. "lowercase, uppercase, digits and symbols"). We
recommend leaving it at *no required characters*. Forced composition rules push
people toward `Password1!` patterns; the length floor plus the leaked-password
check below buys more real security. The shipped strength meter already
*encourages* variety without mandating it.

## 2. Leaked Password Protection (HaveIBeenPwned)

**What:** turn on Supabase's breach-corpus check, so a password that appears in
a known breach is refused at sign-up and at password change.

**Where:** Supabase Dashboard → **Authentication** → **Sign In / Up** →
**Password Security** section → enable **Prevent use of leaked passwords**
(the setting is sometimes labelled "Leaked password protection") → Save.

- Management API equivalent: `PATCH /v1/projects/{ref}/config/auth` with
  `{ "password_hibp_enabled": true }`.
- This is a hosted-project setting; it is not part of the local
  `supabase/config.toml` dev workflow, so staging and production must both be
  set explicitly.

**Why it matters:** this is the one check the client genuinely cannot do. Our
deny-list is intentionally small (site name, a handful of common words, the
user's own name and email local part). It catches lazy passwords, not
*breached* ones. `Ljubicasti-Konj-2019` looks strong to any local heuristic and
would be rejected instantly by HIBP if it has appeared in a dump. Supabase uses
the k-anonymity range API, so only a 5-character prefix of the SHA-1 digest
leaves the server; the password itself is never sent to a third party.

**How to verify:** after enabling, run Supabase's **Advisors → Security
Advisor**. The "Leaked password protection disabled" lint must disappear. Then
try registering with a known-breached password (e.g. `Password123!`) on
staging and confirm the sign-up is refused.

**Expected error mapping:** GoTrue reports this as `weak_password` too, so the
user sees `auth.error_weak_password`, "Lozinka je preslaba. Odaberite dulju i
manje očitu lozinku." No code change needed.

## 3. Two-step sign-in (TOTP authenticator app)

**Status: built and enforced in the application (2026-09-28).** Optional for
individuals and organisations, mandatory for superadmins. TOTP only: Supabase
has no e-mail factor, and SMS is a paid add-on.

### What the person sees

- **Settings** (`/dashboard/postavke#dvostupanjska-prijava`,
  `src/components/account/TwoFactorSettings.tsx`): "Uključi" removes any
  unverified factor an abandoned attempt left behind, enrols a TOTP factor
  named `DajSrce`, shows the QR code and the secret for manual entry, and asks
  for the six-digit code (`challengeAndVerify`). "Isključi" removes the factor;
  Supabase allows that only from an `aal2` session, so an `aal1` session is
  asked for a code first. A superadmin is told it is mandatory and is offered
  no way to turn it off.
- **Sign-in** (`/auth/mfa`): after the password (`/auth/login`), Google or an
  e-mail link (`/auth/callback`), a session whose account has a verified factor
  is `aal1` and is sent to `/auth/mfa?next=<where it was going>`. The code
  raises it to `aal2` and the sign-in continues to the same place: onboarding,
  the role's dashboard or the requested page. A password-recovery link goes
  through the code before the new-password form, because Supabase refuses a
  new password from an `aal1` session of an enrolled account. Signing out (this
  browser only) is the way out.

### What is enforced where

Two facts decide everything. The session's level (`aal`) is a claim in the
signed access token, verified locally like every other read of it
(`getVerifiedClaims`), so nobody can raise it by editing a cookie. Whether the
account *has* a factor is not in the token: Supabase Auth answers it in
`auth.getUser()`, and a copy sits in the session cookie.

| Where | Rule | Source of "has a factor" |
| --- | --- | --- |
| Admin pages (`src/middleware.ts`, `src/app/dashboard/admin/layout.tsx`) | superadmin needs `aal2`; without a factor → settings, with one → `/auth/mfa` | not needed: the `aal2` claim is the rule |
| Admin API (`POST /api/institution-claims/[id]/review`, the only superadmin route) | 403 `{ code: "mfa_required" }` unless a verified factor **and** `aal2` | `auth.getUser()` |
| Every other route that calls `auth.getUser()` (all mutations, own claim, claim search) | 403 `mfa_required` for an enrolled account at `aal1` (`requireSecondFactorIfEnrolled`) | `auth.getUser()` |
| `GET /api/auth/data-token` (the browser's only Data API token) | 403 `mfa_required` for an enrolled account at `aal1`, so the browser cannot reach its rows on the Data API around the routes | `auth.getUser()` |
| `/auth/callback` | redirect to `/auth/mfa?next=...` | `auth.getUser()` |
| Dashboard pages (`src/middleware.ts`, matcher `/dashboard/:path*` only) | enrolled account at `aal1` → `/auth/mfa?next=...` | session cookie |
| Read-only routes that verify the JWT locally (`/api/notifications`, `/api/pledges` and `/api/volunteer-signups` GET, `/api/institution*` GET) | enrolled account at `aal1` reads nothing: empty lists or 403 `mfa_required` (`readerNeedsSecondFactor`) | session cookie |

The admin claim queue shows `mfa_required` in Croatian
(`claimReviewErrorMessageKey`). A contract test in `src/lib/auth/mfa.test.ts`
fails if a route that calls `auth.getUser()` or `getVerifiedClaims()` skips its
rule.

### What is not covered (known gap)

Read-only paths may not call Supabase Auth on every request, and the token does
not say whether the account has a factor, so the dashboard guard and the
read-only routes go by the factor list in the session cookie. The server-side
Data API token (`sessionDataApiToken`, used by server components and those
routes) is minted from the locally verified JWT for any session, enrolled or
not; the two checks above stand in front of it. The cookie's list is Supabase's
answer from the last sign-in or token refresh, which is right for every honest
session; but whoever holds a password-only session can edit their own cookie
and then read (never change) that account's own data: the dashboard pages,
notifications, an organisation's pledge and volunteer lists. Nothing that
changes state, no browser Data API token and no admin page is reachable that
way. Closing it would need either a Supabase Custom Access Token hook that adds
a signed "has a verified factor" claim from `auth.mfa_factors` (then every local
check, the server-side token included, becomes authoritative), or one
`auth.getUser()` on the read-only routes that show other people's personal
data.

Two smaller timing effects: a session opened *before* the factor was added keeps
an old factor list in its cookie until its token refreshes (at most an hour), so
mutations refuse it at once but the dashboard guard only after that refresh; and
a removed factor leaves an `aal2` token valid until it expires, which the admin
API guards against by also requiring the factor itself.

### Supabase settings to confirm

- Dashboard → **Authentication** → **Multi-Factor** → **TOTP (App
  Authenticator)**: enrolment **and** verification enabled. Management API
  fields `mfa_totp_enroll_enabled` and `mfa_totp_verify_enabled`, both `true` on
  2026-09-06. With either off, "Uključi" or the code step fails with a Croatian
  "not available" message and superadmins cannot reach the administration.
- **Maximum enrolled factors** (`mfa_max_enrolled_factors`): anything from 1 up;
  the app keeps one TOTP factor per account and clears unverified leftovers.
- Optional: the security notification e-mails for "verification method
  added/removed" (templates in `AUTH_EMAIL_TEMPLATES.md`).

Before deploying, make sure every superadmin can reach `/dashboard/postavke`:
from the deploy on, the administration opens only after they connect an app
there.

### Lost phone or deleted app

There are no recovery codes. The person writes to kontakt@dajsrce.hr. An
administrator first confirms their identity out of band (for an organisation:
through the register's official mailbox or a phone number from the register,
never only the address the message came from), then deletes the account's TOTP
factor in the Supabase dashboard (Authentication → Users → the account → its
MFA factors). If the dashboard does not offer the deletion, the Auth admin API
does the same from a trusted shell with the service role key, never from the
app: `GET /auth/v1/admin/users/<user_id>/factors`, then
`DELETE /auth/v1/admin/users/<user_id>/factors/<factor_id>`. The person then
signs in with the password alone (`/auth/mfa` notices that the app is gone and
continues) and can connect a new app in the settings. A superadmin's factor is
deleted the same way by another superadmin or the project owner, after which
that superadmin must enrol again before the administration opens.

---

## Release checklist

- [ ] Staging: set minimum password length to `12`.
- [ ] Staging: enable leaked password protection.
- [ ] Staging: register with `Password123!` and confirm rejection; register
      with a fresh 12+ character passphrase and confirm success.
- [ ] Staging: confirm an existing account with a short legacy password can
      still **sign in** (this is the regression that matters most).
- [ ] Staging: Security Advisor shows no leaked-password lint.
- [ ] Production: repeat both settings.
- [ ] Production: re-run the sign-in regression check above.
- [ ] TOTP enrolment and verification confirmed on (section 3).
- [ ] Every superadmin has connected an authenticator app at
      `/dashboard/postavke` and reached the administration with a code.
- [ ] On staging: turn two-step sign-in on and off as an individual, sign in
      with password + code, with Google + code, and reset a password through
      the code.
