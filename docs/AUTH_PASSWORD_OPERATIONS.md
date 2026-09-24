# Supabase Auth settings the release owner must enable

**Status: CODE SHIPPED, LIVE PROJECT NOT CHANGED.** The application half
(nonce CSP, MFA enrolment page, shared rate-limit client, and the three SQL
files under `supabase/migrations/2026092421*.sql`) is in the repo. Nothing
below was executed against the live project. This environment has no
`SUPABASE_ACCESS_TOKEN` and no `DATABASE_URL_UNPOOLED`, so the Auth dashboard
and Neon cannot be changed from here.

## Not applied, because there is no database or Auth-admin access

Read on 2026-09-06 and still the live values. Pushing this commit does not
change them.

| What | Still live | Needs |
| --- | --- | --- |
| `password_min_length` | `6` (target `12`) | `SUPABASE_ACCESS_TOKEN`, Management API |
| `password_hibp_enabled` | `false` | same |
| `mailer_autoconfirm` | `true` (confirmation off) | same |
| `consume_rate_limit` and `rate_limit_buckets` | not created | `DATABASE_URL_UNPOOLED` on Neon, run `20260924210000_shared_rate_limit.sql` |
| `authenticated` grants on `donor_offers` / `offer_claims` | still granted | same, run `20260924210100_revoke_dormant_donor_offer_access.sql` |
| `aal` on the needs and volunteer-event insert policies | not required | same, run `20260924210200_mfa_aal2_for_publishing.sql` |

Until those three SQL files run, the app keeps working: the shared limiter
fails open when `consume_rate_limit` is missing, and publishing still uses the
existing policies. Captcha stays off on purpose; there is no Turnstile or
hCaptcha secret to turn it on.

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
| `mfa_totp_enroll_enabled` / `mfa_totp_verify_enabled` | `true` | keep; app-side enrolment still unbuilt | 3 |
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

## 3. MFA for privileged accounts (admin, NGO and company owners)

**What:** enable TOTP multi-factor authentication for the project, then require
it for accounts that can move money, publish on behalf of an organisation, or
read donor data.

**Where (provider half):** Supabase Dashboard → **Authentication** →
**Multi-Factor Authentication** → enable **TOTP (App Authenticator)** and set
**Maximum enrolled factors** (2 is a sensible default, so a user can enrol a
backup device).

**Why it matters:** password rules cap the damage from *guessing*. They do
nothing against phishing or credential reuse. An NGO dashboard account can
publish needs, accept pledges and read donor contact details; a company owner
account controls a billing relationship. Those are exactly the accounts where a
second factor pays for itself.

The enrolment screen is `/auth/mfa`. Middleware sends a linked NGO or a
superadmin there until the session is `aal2`, and the same check covers the
publishing APIs. The Neon token copies `aal` from the Supabase session so the
RLS migration can read it. That migration is **not applied**. Until it is,
a direct Data API insert still succeeds on a password-only session.

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
- [ ] Neon: apply `20260924210000`, `20260924210100`, and `20260924210200`.
- [ ] MFA enrolment UI is shipped. `aal2` on the publishing policies is not, until the migration above runs.
