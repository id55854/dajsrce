# Supabase Auth e-mail templates (Croatian)

Paste each template into Supabase → Authentication → Emails → Templates (the
subject into "Subject", the HTML into "Message body"). Auth e-mail goes out
through Resend once custom SMTP is enabled (Authentication → Emails → SMTP
Settings: `smtp.resend.com`, port `465`, user `resend`, a sending-only Resend
API key as the password, sender `kontakt@dajsrce.hr`, name `DajSrce`).

The sign-up confirmation and e-mail change templates link to
`/auth/callback?token_hash=…&type=…`, which the callback verifies server-side
with `verifyOtp`. Unlike the default `{{ .ConfirmationURL }}` (a PKCE code that
only exchanges in the browser that signed up), the link works on any device.
**Paste those two only after the callback that accepts `type=email` and
`type=email_change` is deployed**; an older callback ignores them and the
address stays unconfirmed. Password recovery keeps `{{ .ConfirmationURL }}`:
it already uses the implicit flow and opens on any device (see
`PASSWORD_RECOVERY.md`).

Order of importance on launch: 1 and 2 immediately, then 3 and 4, then the
security notifications (enable each one's toggle when pasting it).

Every template uses the same frame. Keep links absolute and never replace a
link with `{{ .SiteURL }}` alone: that carries no proof and no destination.

## 1. Confirm sign up

Subject: `Potvrdite svoju e-adresu za DajSrce`

```html
<!doctype html>
<html lang="hr">
<body style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#b91c1c">DajSrce</p>
<p style="margin:0 0 12px">Pozdrav!</p>
<p style="margin:0 0 20px">Hvala što ste se registrirali na DajSrce. Potvrdite svoju e-adresu kako biste se mogli prijaviti.</p>
<p style="margin:0 0 20px"><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=%2Fdashboard" style="display:inline-block;background:#b91c1c;color:#ffffff;padding:12px 22px;border-radius:9999px;text-decoration:none;font-weight:600">Potvrdi e-adresu</a></p>
<p style="margin:0 0 12px;font-size:14px;color:#57534e">Poveznica se može iskoristiti samo jednom. Ako gumb ne radi, kopirajte ovu adresu u preglednik:<br><span style="word-break:break-all">{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=%2Fdashboard</span></p>
<p style="margin:0 0 12px;font-size:14px;color:#57534e">Ako se niste registrirali na DajSrce, zanemarite ovu poruku.</p>
<p style="margin:24px 0 0;font-size:12px;color:#78716c">DajSrce · Udruga za digitalnu solidarnost DajSrce · kontakt@dajsrce.hr</p>
</div>
</body>
</html>
```

## 2. Reset password

Subject: `Nova lozinka za DajSrce`

```html
<!doctype html>
<html lang="hr">
<body style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#b91c1c">DajSrce</p>
<p style="margin:0 0 12px">Pozdrav!</p>
<p style="margin:0 0 20px">Primili smo zahtjev za novu lozinku za vaš račun na DajSrcu. Kliknite na gumb i upišite novu lozinku.</p>
<p style="margin:0 0 20px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#b91c1c;color:#ffffff;padding:12px 22px;border-radius:9999px;text-decoration:none;font-weight:600">Postavi novu lozinku</a></p>
<p style="margin:0 0 12px;font-size:14px;color:#57534e">Poveznica se može iskoristiti samo jednom. Ako niste zatražili novu lozinku, zanemarite ovu poruku: vaša lozinka ostaje ista.</p>
<p style="margin:24px 0 0;font-size:12px;color:#78716c">DajSrce · Udruga za digitalnu solidarnost DajSrce · kontakt@dajsrce.hr</p>
</div>
</body>
</html>
```

## 3. Change email address

Subject: `Potvrdite novu e-adresu za DajSrce`

```html
<!doctype html>
<html lang="hr">
<body style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#b91c1c">DajSrce</p>
<p style="margin:0 0 12px">Pozdrav!</p>
<p style="margin:0 0 20px">Zatražena je promjena e-adrese vašeg računa na DajSrcu s {{ .Email }} na {{ .NewEmail }}. Potvrdite promjenu klikom na gumb.</p>
<p style="margin:0 0 20px"><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email_change&next=%2Fdashboard" style="display:inline-block;background:#b91c1c;color:#ffffff;padding:12px 22px;border-radius:9999px;text-decoration:none;font-weight:600">Potvrdi novu e-adresu</a></p>
<p style="margin:0 0 12px;font-size:14px;color:#57534e">Ako niste vi zatražili promjenu, zanemarite ovu poruku i javite nam se na kontakt@dajsrce.hr.</p>
<p style="margin:24px 0 0;font-size:12px;color:#78716c">DajSrce · Udruga za digitalnu solidarnost DajSrce · kontakt@dajsrce.hr</p>
</div>
</body>
</html>
```

## 4. Reauthentication

Subject: `Vaš kod za potvrdu na DajSrcu`

```html
<!doctype html>
<html lang="hr">
<body style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#b91c1c">DajSrce</p>
<p style="margin:0 0 12px">Pozdrav!</p>
<p style="margin:0 0 12px">Vaš kod za potvrdu je:</p>
<p style="margin:0 0 20px;font-size:28px;font-weight:700;letter-spacing:4px">{{ .Token }}</p>
<p style="margin:0 0 12px;font-size:14px;color:#57534e">Upišite ga na DajSrcu kako biste dovršili promjenu. Ako niste vi zatražili kod, promijenite lozinku i javite nam se na kontakt@dajsrce.hr.</p>
<p style="margin:24px 0 0;font-size:12px;color:#78716c">DajSrce · Udruga za digitalnu solidarnost DajSrce · kontakt@dajsrce.hr</p>
</div>
</body>
</html>
```

## Security notifications

Supabase → Authentication → Emails → Security. Enable each notification and
paste its template. They tell the account holder about a change they may not
have made; none contains a link that acts on the account.

### Password changed

Subject: `Lozinka vašeg računa na DajSrcu je promijenjena`

```html
<!doctype html>
<html lang="hr">
<body style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#b91c1c">DajSrce</p>
<p style="margin:0 0 12px">Pozdrav!</p>
<p style="margin:0 0 12px">Lozinka za račun {{ .Email }} upravo je promijenjena.</p>
<p style="margin:0 0 12px">Ako ste to bili vi, ništa ne trebate učiniti. Ako niste, odmah zatražite novu lozinku na dajsrce.hr/auth/forgot-password i javite nam se na kontakt@dajsrce.hr.</p>
<p style="margin:24px 0 0;font-size:12px;color:#78716c">DajSrce · Udruga za digitalnu solidarnost DajSrce · kontakt@dajsrce.hr</p>
</div>
</body>
</html>
```

### Email address changed

Subject: `E-adresa vašeg računa na DajSrcu je promijenjena`

```html
<!doctype html>
<html lang="hr">
<body style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#b91c1c">DajSrce</p>
<p style="margin:0 0 12px">Pozdrav!</p>
<p style="margin:0 0 12px">E-adresa vašeg računa na DajSrcu promijenjena je s {{ .OldEmail }} na {{ .Email }}.</p>
<p style="margin:0 0 12px">Ako to niste bili vi, odmah nam se javite na kontakt@dajsrce.hr.</p>
<p style="margin:24px 0 0;font-size:12px;color:#78716c">DajSrce · Udruga za digitalnu solidarnost DajSrce · kontakt@dajsrce.hr</p>
</div>
</body>
</html>
```

### Verification method added (two-step sign-in turned on)

Subject: `Dvostupanjska prijava na DajSrcu je uključena`

```html
<!doctype html>
<html lang="hr">
<body style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#b91c1c">DajSrce</p>
<p style="margin:0 0 12px">Pozdrav!</p>
<p style="margin:0 0 12px">Na račun {{ .Email }} dodan je novi način potvrde prijave ({{ .FactorType }}). Od sada se pri prijavi traži i kod iz vaše aplikacije za autentifikaciju.</p>
<p style="margin:0 0 12px">Ako to niste bili vi, odmah promijenite lozinku i javite nam se na kontakt@dajsrce.hr.</p>
<p style="margin:24px 0 0;font-size:12px;color:#78716c">DajSrce · Udruga za digitalnu solidarnost DajSrce · kontakt@dajsrce.hr</p>
</div>
</body>
</html>
```

### Verification method removed (two-step sign-in turned off)

Subject: `Dvostupanjska prijava na DajSrcu je isključena`

```html
<!doctype html>
<html lang="hr">
<body style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#b91c1c">DajSrce</p>
<p style="margin:0 0 12px">Pozdrav!</p>
<p style="margin:0 0 12px">S računa {{ .Email }} uklonjen je način potvrde prijave ({{ .FactorType }}).</p>
<p style="margin:0 0 12px">Ako to niste bili vi, odmah promijenite lozinku i javite nam se na kontakt@dajsrce.hr.</p>
<p style="margin:24px 0 0;font-size:12px;color:#78716c">DajSrce · Udruga za digitalnu solidarnost DajSrce · kontakt@dajsrce.hr</p>
</div>
</body>
</html>
```

### Sign-in method linked

Subject: `Novi način prijave na DajSrce`

```html
<!doctype html>
<html lang="hr">
<body style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#b91c1c">DajSrce</p>
<p style="margin:0 0 12px">Pozdrav!</p>
<p style="margin:0 0 12px">Uz račun {{ .Email }} povezan je novi način prijave: {{ .Provider }}.</p>
<p style="margin:0 0 12px">Ako to niste bili vi, odmah promijenite lozinku i javite nam se na kontakt@dajsrce.hr.</p>
<p style="margin:24px 0 0;font-size:12px;color:#78716c">DajSrce · Udruga za digitalnu solidarnost DajSrce · kontakt@dajsrce.hr</p>
</div>
</body>
</html>
```

### Sign-in method removed

Subject: `Način prijave na DajSrce je uklonjen`

```html
<!doctype html>
<html lang="hr">
<body style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917;line-height:1.5">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#b91c1c">DajSrce</p>
<p style="margin:0 0 12px">Pozdrav!</p>
<p style="margin:0 0 12px">S računa {{ .Email }} uklonjen je način prijave: {{ .Provider }}.</p>
<p style="margin:0 0 12px">Ako to niste bili vi, javite nam se na kontakt@dajsrce.hr.</p>
<p style="margin:24px 0 0;font-size:12px;color:#78716c">DajSrce · Udruga za digitalnu solidarnost DajSrce · kontakt@dajsrce.hr</p>
</div>
</body>
</html>
```

## Verification

1. Register with a fresh address on a computer; open the confirmation on a
   phone. It must land on `/auth/setup` (association) or the individual
   dashboard, signed in, not on "Prijava nije uspjela".
2. Open the same link again: the login page says the link has expired or has
   already been used.
3. Check the message headers once: `From: DajSrce <kontakt@dajsrce.hr>`, SPF
   and DKIM `pass` for dajsrce.hr, not in spam.
