# Privacy, DSA and outreach operations

Internal runbook for requests about personal data, personal-data breaches, content notices and
the outreach e-mails to associations. The public texts it implements are `/pravila-privatnosti`,
`/uvjeti-koristenja` and `/kolacici` (version 1.0, in force from 27 September 2026). When a
procedure here changes what those pages promise, change the pages in the same commit.

This repository is public. Keep requests, logs, the suppression list and anything else that
names a person outside it, in the association's private records.

## 1. The mailbox and who answers it

- `kontakt@dajsrce.hr` is the only published contact. It receives GDPR requests, DSA notices and
  complaints, authority contact (DSA Art. 11 and 12 points of contact) and outreach opt-outs.
- The association's board designates a **privacy lead** who owns the mailbox and one **backup**;
  both have access, so deadlines survive holidays. The association's legal representative stays
  accountable. Record the current names in the association's internal records.
- Read it every working day. A person answers; an auto-reply never counts as an answer (terms 11).
- Log every message that is a request or notice on arrival (sections 9 and 12 list the logs).

## 2. Deadlines

| What | Deadline |
|---|---|
| GDPR request (access, export, erasure, rectification, restriction, objection) | without undue delay, at the latest **one month** from receipt (Art. 12(3)). Extendable by two months for complex or numerous requests, telling the requester within the first month and why. If we will not act, say so within the month, with reasons and the right to complain to AZOP |
| Outreach opt-out | within 48 hours |
| DSA notice | confirm receipt without undue delay; decide in a timely way |
| Personal-data breach | AZOP within **72 hours** of becoming aware |

Requests are free. A manifestly unfounded or excessive request may be refused, with reasons
(Art. 12(5)).

## 3. Verifying the requester

- Act on a request that comes from the e-mail address of the account (the Supabase Auth user).
- From any other address: reply to the account address and ask the holder to confirm from there.
  Do not tell the unverified sender whether an account exists.
- Ask for more only when there is a reasonable doubt (Art. 12(6)), and then for the minimum.
  Never ask for a copy of an identity document by default.
- Someone acting for another person (a parent, a lawyer) needs written authority.
- Register data (a personal e-mail or home address shown as an association's data): verify
  control of that address by writing to it.

## 4. Account deletion (erasure)

Identity lives in Supabase Auth, everything else in Neon, and `profiles_id_fkey` is gone, so
deleting one does not delete the other. Do both, in this order. SQL runs in `psql` against the
Neon production branch with `DATABASE_URL_UNPOOLED` (as `neondb_owner`).

1. **Find the user.** Supabase dashboard, project `wbxvpdbhddespdsscsnw`, Authentication, Users:
   search the e-mail and copy the user UID. Then:

   ```sql
   \set uid '00000000-0000-0000-0000-000000000000'
   select id, email, name, role, institution_id, created_at from public.profiles where id = :'uid';
   ```

2. **Note the associations that received the data** (Art. 19):

   ```sql
   select i.id, i.name from public.institutions i where i.id in (
     select n.institution_id from public.pledges p join public.needs n on n.id = p.need_id
     where p.user_id = :'uid'
     union
     select e.institution_id from public.volunteer_signups s
     join public.volunteer_events e on e.id = s.event_id where s.user_id = :'uid');
   ```

3. **Delete the Supabase Auth user** (the user's row, Delete user). Sign-in ends at once; an
   access token already issued stays valid for up to an hour.

4. **Delete the Neon rows** in one transaction:

   ```sql
   begin;
   -- Nothing may block the delete (confdeltype c = cascade, n = set null; a or r blocks).
   select conrelid::regclass, conname, confdeltype from pg_constraint
   where contype = 'f' and confrelid = 'public.profiles'::regclass;

   -- Take the name out first, so the withdrawal notices below do not carry it.
   select name as old_name from public.profiles where id = :'uid' \gset
   update public.profiles set name = '(račun izbrisan)' where id = :'uid';

   -- Withdraw standing pledges and signups through the transactions: a cascade would not
   -- release needs.quantity_pledged or volunteer_events.volunteers_signed_up.
   select public.cancel_pledge_transaction(:'uid', id)
   from public.pledges where user_id = :'uid' and status = 'pledged';
   select public.cancel_volunteer_signup_transaction(:'uid', id)
   from public.volunteer_signups where user_id = :'uid' and cancelled_at is null
     and checked_in_at is null and checked_out_at is null;

   -- Earlier notices to associations and administrators name the person. Look before
   -- replacing when the name is short or common.
   select id, body from public.notifications
   where user_id <> :'uid' and position(:'old_name' in body) > 0;
   update public.notifications set body = replace(body, :'old_name', '(račun izbrisan)')
   where user_id <> :'uid' and position(:'old_name' in body) > 0;

   -- The person's own notices: notifications.user_id pointed at auth.users on Supabase and
   -- may have no foreign key on Neon, so delete them explicitly.
   delete from public.notifications where user_id = :'uid';

   -- Cascades pledges, volunteer_signups and institution_claims; sets
   -- audit_log.actor_profile_id and institution_claims.reviewed_by to null.
   delete from public.profiles where id = :'uid';
   commit;
   ```

   The audit trail keeps each event with the actor nulled; its hash chain is untouched. If the
   person's authority over an association is in dispute, save the approved claim row to the
   privacy log before deleting (Art. 17(3)(e)).

5. **An hour later, run the lookup from step 1 again.** `ensure_own_profile()` recreates a profile
   for any session that was still valid; delete such a row again.
6. **An `ngo` account:** the association's needs and events belong to the association and stay.
   If this was its only account, tell the association it no longer has anyone on DajSrce.
7. **Tell the associations from step 2** that the person asked for erasure and that they should
   delete what they hold unless they must keep it (for example a volunteering contract).
8. **Backups** keep deleted data for up to 30 days. Never restore a deleted account; after any
   restore, replay the deletions recorded in the privacy log.
9. **Reply** to the requester and close the log entry.

## 5. Data export (access and portability)

Send the person a JSON file of everything keyed to them, to the account address only. It
covers:

- `profiles`: the whole row (account identity, role, association link, locale, legacy location
  and interest fields);
- `pledges`: every row, with the need title and the association's name;
- `volunteer_signups`: every row, with the event title, date and association;
- `institution_claims`: every row they filed, without `email_token_hash` and
  `email_token_expires_at`;
- `notifications`: `created_at`, `title`, `body`, `link`, `is_read`;
- `audit_log` rows where they are the actor: `created_at`, `action`, `entity_type`, `entity_id`,
  `payload` (not the hash chain);
- the Supabase Auth user: `GET https://wbxvpdbhddespdsscsnw.supabase.co/auth/v1/admin/users/<uid>`
  with the service-role key (dashboard, API keys; run it locally, never paste the key anywhere),
  keeping e-mail, sign-up and last sign-in times, providers and `user_metadata`.

```sql
\set uid '00000000-0000-0000-0000-000000000000'
\pset tuples_only on
\pset format unaligned
\o export.json
select jsonb_pretty(jsonb_build_object(
  'exported_at', now(),
  'profile', (select to_jsonb(p) from public.profiles p where p.id = :'uid'),
  'pledges', (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object(
      'need_title', n.title, 'organisation', i.name) order by x.created_at), '[]')
    from public.pledges x join public.needs n on n.id = x.need_id
    join public.institutions i on i.id = n.institution_id where x.user_id = :'uid'),
  'volunteer_signups', (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
      'event_title', e.title, 'event_date', e.event_date, 'organisation', i.name)
      order by s.created_at), '[]')
    from public.volunteer_signups s join public.volunteer_events e on e.id = s.event_id
    join public.institutions i on i.id = e.institution_id where s.user_id = :'uid'),
  'institution_claims', (select coalesce(jsonb_agg(
      to_jsonb(c) - 'email_token_hash' - 'email_token_expires_at' order by c.created_at), '[]')
    from public.institution_claims c where c.profile_id = :'uid'),
  'notifications', (select coalesce(jsonb_agg(jsonb_build_object(
      'created_at', n.created_at, 'title', n.title, 'body', n.body, 'link', n.link,
      'is_read', n.is_read) order by n.created_at), '[]')
    from public.notifications n where n.user_id = :'uid'),
  'activity', (select coalesce(jsonb_agg(jsonb_build_object(
      'created_at', a.created_at, 'action', a.action, 'entity_type', a.entity_type,
      'entity_id', a.entity_id, 'payload', a.payload) order by a.id), '[]')
    from public.audit_log a where a.actor_profile_id = :'uid')));
\o
```

With an access request, also answer the Art. 15(1) questions (purposes, recipients, retention,
rights, source) by pointing to the sections of `/pravila-privatnosti`. Delete `export.json` once
it is sent; log only that it was sent.

## 6. Rectification

- **Account name or e-mail** (there is no self-service yet): change both systems.
  - Supabase: `PUT https://wbxvpdbhddespdsscsnw.supabase.co/auth/v1/admin/users/<uid>` with the
    service-role key and `{"email": "...", "email_confirm": true}` and/or
    `{"user_metadata": {"name": "..."}}`.
  - Neon, because `ensure_own_profile()` copies these only once:
    `update public.profiles set name = '...', email = '...' where id = :'uid';`
  - Notices already sent under the old name stay unless the person asks (then as in 4, step 4).
- **Register data:** we cannot edit the official register. The association corrects it at the
  competent state administration office; a personal e-mail or home address shown meanwhile is
  handled as an objection (section 7).
- **A claimed association's profile:** the association edits it itself.

## 7. Objection, opt-out and the suppression list

- **Outreach opt-out** (direct marketing, Art. 21(2) and (3), absolute): any "ODJAVA" reply or
  request adds the address to the **suppression list** within 48 hours; we never write to it
  again. The list holds only the address (lower case), the date and how it arrived, and is
  checked before every send, reminders included. It is kept as long as needed to honour the
  request (privacy policy 5).
- **Objection to other legitimate-interest processing** (Art. 21(1); policy 2.1 to 2.4 and 2.8
  to 2.11): weigh the person's particular situation; stop unless there are compelling legitimate
  grounds or a legal claim; answer within the month.
- **A personal e-mail or home address shown as register data:** if the objection stands, blank
  that field for that `UDR_ID` in the published directory and record the `UDR_ID` and field in the
  privacy log. The registry pipeline has no suppression flag yet, so re-check after every registry
  sync until it does, and tell the person to have the register corrected.
- **Restriction** (Art. 18): record it in the privacy log and stop the use concerned until it is
  resolved.

## 8. Personal-data breach

1. **Contain:** revoke or rotate what leaked (for example the `DATA_API_JWT_PRIVATE_JWK` pair,
   `DATABASE_URL_UNPOOLED`, the Resend key), close the path.
2. **Assess** within hours: what data, whose, how many people, likely consequences. Decide whether
   it is unlikely to create a risk (no notification), a risk (AZOP) or a high risk (AZOP and the
   people affected).
3. **Notify AZOP within 72 hours** of becoming aware, unless the breach is unlikely to result in a
   risk (Art. 33): use the breach notification form on azop.hr or write to azop@azop.hr. A
   notification may be completed in phases; explain any delay beyond 72 hours.
4. **Tell the people affected** without undue delay when the risk is high (Art. 34): what
   happened, the likely consequences, what we did, what they can do, whom to contact.
5. **Log every breach**, notified or not (Art. 33(5)): when it was found, what happened, data and
   people affected, consequences, actions, the notification decisions with times and reasons.
6. A processor's incident notice (Supabase, Neon, Vercel, Resend, GitHub, CARTO) starts the
   72-hour clock like our own discovery.

Typical cases here: an outreach e-mail with recipients visible in To or CC, an export sent to
the wrong address, a leaked service-role key, an RLS mistake exposing one association's donors
to another.

## 9. DSA notice and action

Channels: the „Prijavi sadržaj” link on needs and volunteer events, and e-mail to
`kontakt@dajsrce.hr` with the subject „Prijava sadržaja” (terms 8).

1. **Log** the notice (fields below).
2. **Confirm receipt** without undue delay when the notifier gave an e-mail (template A).
3. **Assess** it: illegal under Croatian or EU law, or against terms 6? Is it complete (reasons,
   exact URL, name and e-mail except for child sexual abuse content, good-faith statement)? A
   complete notice gives us actual knowledge: act expeditiously (terms 13.3).
4. **Decide** diligently, objectively and not arbitrarily. A person decides; no automated means.
5. **Tell the notifier** the decision and the redress available (template B). Do not reveal the
   notifier to the association unless necessary or they agree (privacy policy 2.10).
6. **Statement of reasons** (Art. 17): when we remove or restrict content, suspend or close an
   account, or reject or revoke an association's approval, send template C to the account's
   e-mail, at the latest when the measure takes effect. As a micro enterprise we submit nothing
   to the Commission's transparency database (Art. 19 exempts us from Art. 24(5)).
7. **Complaints** within six months: reviewed by a person, where possible one not involved in
   the decision (terms 9.2).
8. **Art. 18 escalation:** if information suggests a criminal offence that threatens someone's
   life or safety has taken place, is taking place or is likely, inform the police at once (112 in
   an emergency, otherwise 192 or the nearest police station) or the State Attorney's Office
   (DORH), with all relevant information, and log it. Comply with orders from authorities
   (Arts. 9 and 10) and tell the authority what was done.
9. Someone who keeps sending manifestly unfounded notices is warned, then their notices are set
   aside for a reasonable period (terms 8.3).

**Notice log fields:** notice id; received (date and time); channel; notifier name and e-mail
(or "anonymous: CSAM"); content URL and content id; content owner (institution or profile id);
reason given; illegal or against the terms; good-faith statement present; receipt confirmed at;
reviewer; decision and date; measure (none, removal, disabled access, restricted visibility,
posting ban, suspension, closure, claim rejection or revocation) and its duration; ground (legal
provision or terms clause); automated means used (no); notifier informed at; statement of reasons
sent at; complaint received, outcome, reviewer; Art. 18 referral (authority, date, reference);
closed at. Keep entries for 3 years after closing (privacy policy 5).

### Template A: receipt confirmation

```text
Naslov: Primili smo vašu prijavu sadržaja ({broj prijave})

Poštovani,

potvrđujemo da smo {datum} primili vašu prijavu sadržaja na adresi {URL}.
Broj prijave: {broj prijave}.

Prijavu će pregledati član tima DajSrca. O odluci ćemo vas obavijestiti na ovu
e-adresu.

Srdačan pozdrav,
DajSrce · UDRUGA ZA DIGITALNU SOLIDARNOST DAJSRCE · kontakt@dajsrce.hr
```

### Template B: decision to the notifier

```text
Naslov: Odluka o vašoj prijavi sadržaja ({broj prijave})

Poštovani,

pregledali smo vašu prijavu {broj prijave} od {datum}, koja se odnosi na {URL}.

Odluka: {sadržaj smo uklonili / pristup sadržaju smo onemogućili / vidljivost
sadržaja smo ograničili / nismo poduzeli mjere}.
Razlog: {zašto sadržaj jest ili nije nezakonit, odnosno jest ili nije protivan
točki ... Uvjeta korištenja}.

Odluku je donio član tima DajSrca, bez automatiziranih alata.

Ako se s odlukom ne slažete, u roku od šest mjeseci možete nam podnijeti prigovor
na kontakt@dajsrce.hr. Možete se obratiti i tijelu za izvansudsko rješavanje
sporova certificiranom prema članku 21. Akta o digitalnim uslugama ili nadležnom
sudu, a pritužbu možete podnijeti Hrvatskoj regulatornoj agenciji za mrežne
djelatnosti (HAKOM).

Srdačan pozdrav,
DajSrce · UDRUGA ZA DIGITALNU SOLIDARNOST DAJSRCE · kontakt@dajsrce.hr
```

### Template C: statement of reasons (Art. 17)

```text
Naslov: Obrazloženje odluke o {vašem sadržaju / vašem računu} na DajSrcu

Poštovani,

obavještavamo vas o mjeri koju smo poduzeli na platformi DajSrce.

1. Mjera: {uklanjanje sadržaja / onemogućavanje pristupa sadržaju / ograničavanje
   vidljivosti / privremena zabrana objavljivanja / suspenzija računa / zatvaranje
   računa / odbijanje ili opoziv odobrenja udruge}.
   Opseg: {koji sadržaj ili račun, s poveznicom}. Trajanje: {do datuma / trajno}.
2. Činjenice i okolnosti: {što smo utvrdili}. Odluku smo donijeli {na temelju
   prijave primljene {datum} / na vlastitu inicijativu}.
3. Automatizirani alati: pri otkrivanju i odlučivanju nismo ih koristili.
4. Osnova: {za nezakonit sadržaj: propis i članak te zašto je sadržaj s njim
   protivan} / {za sadržaj protivan uvjetima: točka ... Uvjeta korištenja
   (dajsrce.hr/uvjeti-koristenja) te zašto je sadržaj s njom protivan}.
5. Pravna zaštita: u roku od šest mjeseci možete nam podnijeti prigovor na
   kontakt@dajsrce.hr; razmatra ga čovjek, po mogućnosti osoba koja nije
   sudjelovala u ovoj odluci. Možete se obratiti i tijelu za izvansudsko
   rješavanje sporova certificiranom prema članku 21. Akta o digitalnim uslugama
   ili nadležnom sudu, a pritužbu možete podnijeti HAKOM-u (članak 53. Akta).

Srdačan pozdrav,
DajSrce · UDRUGA ZA DIGITALNU SOLIDARNOST DAJSRCE · kontakt@dajsrce.hr
```

## 10. HAKOM e-Pružatelj notification

- **Duty:** čl. 23. Zakona o provedbi Akta o digitalnim uslugama (NN 67/25): an intermediary
  service provider established in Croatia notifies HAKOM, the Digital Services Coordinator.
  DajSrce is a hosting service and an online platform.
- **How:** through HAKOM's e-Pružatelj application on hakom.hr. Give the registered name, OIB,
  seat, `kontakt@dajsrce.hr` as the single point of contact, the service (hosting service and
  online platform at https://dajsrce.hr) and its start date.
- **When:** now. Existing providers had until 29 October 2025; the act sets no date for later
  entrants. The notification is not a condition for providing the service, but not filing is an
  offence (čl. 18.: EUR 6,630 to 66,360, or up to 6 % of turnover).
- **Status:** not filed as of 26 September 2026. Record the filing date and HAKOM's reference in
  the association's records once filed.

## 11. Outreach to associations

- One recipient per message (or BCC). Never a visible To or CC list: that is a breach (section 8).
- Send from `kontakt@dajsrce.hr`, on dajsrce.hr with SPF, DKIM and DMARC in place.
- No open or click tracking and no tracking pixels (turn them off in the mail tool); no
  attachments; plain text or simple HTML.
- Every message carries the outreach footer: sender identity, the ODJAVA opt-out, where the
  address came from, purpose, legal basis, rights and the link to `/pravila-privatnosti`.
- Log each address with its source (register or website, and the date it was taken) and the send
  dates.
- Check the suppression list before every send. At most **one reminder**, no earlier than 7 days
  after the first message; nothing after an opt-out.
- Skip addresses that are clearly a private person's rather than the association's, and
  associations that already have an account. Never add an address to a newsletter.
- A reply that asks about data or deletion is a GDPR request (section 2).
- Save the legitimate-interest assessment before the first send.
- A new sending service is a new processor: add it to the recipients table in
  `/pravila-privatnosti` and have a data processing agreement in place before using it.

## 12. Retention and records

- The retention periods in privacy policy 5 are **not automated yet**. Until a cleanup job
  exists, the privacy lead checks `min(created_at)` (or the withdrawal and closing dates) of each
  table on the first working day of every month and deletes by hand whatever has passed its
  period. Audit-log pruning must keep the hash chain verifiable from the oldest remaining row.
- Kept privately, never in this repository: the privacy log (requests), the notice log (DSA), the
  breach log, the suppression list, the outreach log, the legitimate-interest assessments and the
  records of processing (Art. 30).
