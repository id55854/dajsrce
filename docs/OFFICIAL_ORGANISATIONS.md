# Organisations outside Registar udruga

## Why

Caritas Zagrebačke nadbiskupije could not register (2026-09-30). A claim was
a reviewed claim against a Registar udruga UDR_ID only, and Caritas is not
an association. It is a legal person of the Catholic Church, recorded in:

- the Church's register (evidencijski broj 1.379);
- RNO (0053015);
- MROSP's register of social-service providers;
- the food-donation intermediaries' register (no. 10).

The same was true of every Caritas, parish, charity of another religious
community, foundation and social-care institution (children's and elderly
homes). Red Cross societies are associations and always could claim.

## Sources

| Key | Register | Publisher, access | Licence | Active rows (2026-09-30) |
|---|---|---|---|---|
| `epokc:<evidencijski broj>` | Evidencija pravnih osoba Katoličke Crkve u RH | data.gov.hr, CTS CSV, daily | Otvorena dozvola | 2,104 |
| `evz:<evidencijski broj>` | Evidencija vjerskih zajednica u RH, communities and organisational units | data.gov.hr, CSV, daily | Otvorena dozvola | 54 + 863 |
| `zaklade:<registarski broj>` | Registar zaklada RH | data.gov.hr, CTS CSV, daily | Otvorena dozvola | 352 |
| `oib:<OIB>` | MROSP Registar pružatelja socijalnih usluga | `mrosp.gov.hr/registar/registar.json`, daily | Otvorena dozvola | 364 legal persons |
| (contacts only) | RNO, Registar neprofitnih organizacija | `banovac.mfin.hr/rnoprt/Export` ("CSV izvoz"), daily | not stated | 455 matches |

The RNO export is UTF-16LE with `$` between fields. It also lists named people and IBANs. The
sync reads only the number, e-mail, phone, website and seat of organisations already found in
the open registers, and never stores anything else from it. RNO does not state a reuse licence,
so none of its data is published: it is used only to verify a claim.

**Left out of MROSP:**

- associations, which claim by UDR_ID;
- companies, crafts and cooperatives;
- natural persons;
- local government;
- Hrvatski zavod za socijalni rad.

Every row whose OIB is an active Registar udruga row is also left out, for the same reason.

**Merge rules:**

- There is one row per organisation, keyed by the first register in the order epokc, evz,
  zaklade, mrosp.
- A later register with the same OIB is added to that row's `registers` instead of making a
  second row.
- The Church register omits some OIBs, for example for Caritas Split and Caritas Šibenik. There
  a row without an OIB joins a provider row with the same folded name and place.
- Seat and county come from MROSP when it has them, because the ministry registers name no county.

**E-mail for the mailbox challenge,** in order: RNO, then MROSP, then Registar zaklada. On
2026-09-30, 725 of 3,699 organisations had one. That includes 18 of the 23 Caritas rows;
Caritas Zagrebačke nadbiskupije's is czn@czn.hr from RNO. Parishes mostly have none. Their
claims are approved after an out-of-band check recorded as `Provjereno: …`, as for associations
without a register e-mail.

**Not used as sources:**

- the food-donation intermediaries' register (an XLSX last updated 18.4.2024, 142 rows);
- MROSP's list of permanent humanitarian-aid collectors (a PDF);
- Sudski registar: the ustanove that matter are in MROSP.

A reviewer may cite any of them in the `Provjereno:` note.

## Data flow

1. `npm run organisations:sync -- --dry-run [--output rows.json]` downloads everything, prints
   the counts and writes nothing. Without `--dry-run` it runs
   `begin_official_organisations_sync`, then upserts in batches of 500 through
   `upsert_official_organisations_batch`, then calls `finish_official_organisations_sync`.
   - Finishing deactivates the rows the run did not see.
   - It refuses when the run saw fewer than 90% of the rows that were active.
   - The CLI also refuses when a register yields fewer rows than its floor
     (`MINIMUM_ROWS`, set well under today's sizes).
2. `node scripts/audit-dgu-address-match.mjs --organisations --archive <DGU zip> --output
   matches.jsonl` matches seats to DGU buildings (74% on 2026-09-30), and
   `npm run organisations:geocodes:import -- --input matches.jsonl` applies them. A changed
   address clears the point at the next sync.
3. `.github/workflows/organisations-sync.yml` runs both every Sunday and can also be started by
   hand. It needs `PRODUCTION_DATA_API_URL` and `PRODUCTION_DATA_API_JWT_PRIVATE_JWK`.

## Claims

- **Search:** `search_claimable_associations_v1` searches Registar udruga and
  `official_organisations` together. Each item carries `register`.
- **Claim key:** the key is stored in `institution_claims.udr_id`, which is now "the register
  key". `is_official_organisation_key()` sends it down the organisation path:
  `request_organisation_claim_transaction` and `approve_organisation_claim_transaction`. The
  association path is byte for byte the previous one, and a contract test checks that.
- **Approval:** the same steps as for an association: the register mailbox or a recorded
  `Provjereno:` check, and a social category the reviewer chooses (the registers carry none).
  It creates an `organisation_claim` institution, or takes back the organisation's own earlier
  one whose account is gone. Curated institutions are never taken over: Caritas Zagrebačke
  nadbiskupije's three curated service rows at Babonićeva 121 stay as they are next to its
  claimed profile.
- **Location of a new profile:** the DGU building of the seat, otherwise a hidden coarse point in
  its place. The approval refuses when the place is not known unambiguously.
- **Map:** `organisation_claim` institutions appear on the map like curated ones
  (`map_association_registry_v1`).
- **Caritas on the map:** unclaimed organisations are not on the map, except Caritas.
  `refresh_official_organisation_map_points()` keeps one unverified `official_register`
  institution (category `caritas`, name and seat from the register, no contacts) on the DGU
  building of every active Caritas of the Church or religious-community register. It runs after
  every sync and geocode import. A Caritas without a DGU building is left off (on 2026-10-05:
  Zadar `bb`, Bjelovar, Knin), and so is one whose seat already has a curated institution
  (Caritas Zagrebačke nadbiskupije, Babonićeva 121). Its approved claim takes that pin over.
- **Not built:** other unclaimed organisations stay off the map; only the claim search sees
  them. They are also not in the engaged directory `/organisations`, which is register based.

## Privacy

Privacy policy 2.9 describes this processing. An objection to a personal e-mail or phone shown as
an organisation's contact is handled with:

```sql
update public.official_organisations
set contacts_suppressed = true, email = null, email_source = null, phone = null
where id = '<key>';
```

After that the sync never stores those fields again.
