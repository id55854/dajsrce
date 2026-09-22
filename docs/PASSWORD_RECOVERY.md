# Password recovery

Recovery requests go through `POST /api/auth/password-recovery`. The route
requires a same-origin request, validates and normalizes the email, limits by
both client address and a non-reversible email digest, and returns the same
accepted response whether or not the account exists. It uses an isolated,
non-persistent Supabase client with the implicit flow. The email's one-use
confirmation link can therefore be opened on another device without a PKCE
verifier cookie from the requesting browser. Normal sign-in, signup and OAuth
continue to use the cookie-backed PKCE client.

The redirect origin comes only from `NEXT_PUBLIC_APP_URL` on the server. A
browser caller cannot replace it with an attacker-controlled recovery target.

The default Supabase recovery email must use `{{ .ConfirmationURL }}`. Its
redirect target is `/auth/callback?next=%2Fauth%2Freset-password` on the origin
configured by `NEXT_PUBLIC_APP_URL`. That URL must be allowed in Supabase
Authentication → URL Configuration
(including additional `sb_flow_id` query parameters for older PKCE links).
The callback forwards fragment-based recovery to `/auth/reset-password` without
going through login or NGO onboarding. The reset page removes the fragment,
establishes the cookie-backed session, and saves the new password using
`supabase.auth.updateUser({ password })`. Supabase Auth hashes and persists
the password; no application profile password column is needed.

An existing session is never treated as proof of a recovery request: navigating
straight to `/auth/reset-password` while already signed in must not open the
form. Supabase stamps a recovery-minted access token with `amr: [{ method:
"recovery", timestamp }]`, and `establishRecoverySession` requires that claim,
timestamped within the last hour, before rendering the new-password form —
an ordinary signed-in session (`amr` method `password`/`oauth`) is rejected
the same as a missing or expired one.

Custom recovery templates can alternatively use
`{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery`.
The callback verifies that one-use token server-side. Never replace the link
with `{{ .SiteURL }}` alone: that contains no recovery proof or destination.

Old PKCE emails remain supported in their originating browser. A person opening
an old PKCE email on another device must request a new email after deployment.
Expired, reused and malformed recovery links display the reset error page with
a link to request another email, even if another account is already signed in.

## Verification

Automated tests cover portable email requests, fragment session establishment,
token-hash and PKCE callbacks, NGO onboarding bypass, invalid links, and redirect
validation. Production email delivery and provider settings require a live test:

1. Request a fresh recovery email for a test account.
2. Open it in the same browser; confirm the new-password form appears.
3. Request another email and open it on a different device/private browser.
4. Save a new password, sign out, and confirm that only the new password signs in.
5. Reopen the consumed email link; confirm the invalid-link screen appears.
6. Repeat with a pending NGO account; recovery must not open onboarding first.
7. While already signed in, navigate straight to `/auth/reset-password` with no
   emailed link; confirm the invalid-link screen appears rather than the form.

Do not log email links, fragment tokens, passwords, or recovery sessions.
