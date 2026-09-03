# Supabase Auth settings the release owner must enable

**Status: NOT APPLIED.** Everything below is a provider/dashboard setting, not
application code. It was deliberately left out of the code change because
faking it in the client would be security theatre; the client can be bypassed
entirely by calling the Supabase Auth API directly.

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

**Important caveat; the toggle alone enforces nothing.** Enabling the provider
setting only makes enrolment *possible*. Actually requiring MFA is application
and database work that is **not implemented**, and needs to be scheduled
deliberately:

1. Enrolment and challenge UI using `supabase.auth.mfa.enroll()`,
   `.challenge()` and `.verify()`; there is no such screen in the app today.
2. Enforcement at the data layer: Supabase encodes the achieved factor level in
   the JWT `aal` claim (`aal1` = password only, `aal2` = password + second
   factor). Privileged RLS policies and the service-role RPCs would gate on
   `auth.jwt() ->> 'aal' = 'aal2'` rather than trusting a client flag; which is
   consistent with the project invariant that roles and entitlements are never
   derived from user metadata or request bodies.
3. A recovery path, agreed with support, for a user who loses their device.

Enabling the toggle before that work exists is harmless and is a prerequisite,
but do not record MFA as "done" at that point.

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
- [ ] Backlog ticket opened for MFA enrolment UI + `aal2` enforcement.
