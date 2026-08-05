# Exact association coordinates

## Decision

Use the Croatian State Geodetic Administration (DGU) INSPIRE Addresses
dataset as the authoritative building-coordinate source. It is free, official,
downloadable, reusable under Croatia's Open Data Licence, and compatible with
the application's existing Leaflet/OpenStreetMap/CARTO map.

Do not bulk-geocode the registry with Google while the result is displayed on
Leaflet. Google generally restricts storage of Geocoding API content and
requires geocoding results displayed on a map to be displayed on a Google map.
A Google migration is therefore a map-provider and licensing decision, not
merely an API-key change.

Sources:

- DGU INSPIRE/open-data catalogue: https://dgu.gov.hr/print.aspx?id=6596&url=print
- DGU Addresses ATOM feed: https://geoportal.dgu.hr/services/atom/ad/xml
- Google Geocoding API policies: https://developers.google.com/maps/documentation/geocoding/policies
- Google Maps pricing: https://developers.google.com/maps/billing-and-pricing/faq

## Current measured coverage

The 2 August 2026 DGU archive contains 1,681,462 address points. Against the
43,703 active associations currently published by DajSrce:

- 39,414 have one unambiguous house-number/building match (90.19%).
- 188 have multiple plausible address points and are quarantined as ambiguous.
- 4,101 cannot be matched conservatively.
- 403 of the unmatched records have missing or unusable official street data
  such as `bb` (without a house number).

Unresolved records remain on the map at explicitly labelled city/county
precision. Assigning those records a building point would be fabricated
precision; the correct remediation is better official address data or manual
review with evidence.

## Matching rules

`scripts/audit-dgu-address-match.mjs` streams `Address.gml` directly from the
compressed DGU archive. It does not extract the 2.6 GB GML document or load it
into memory. DGU EPSG:3035 coordinates are transformed to WGS84 with `proj4`.

Matches are accepted in descending confidence order:

1. Normalized full official address equals the DGU building-address prefix.
2. The same comparison after removing an apartment/unit suffix.
3. The same comparison after normalizing the optional street-type word.
4. A structured match on settlement/postal locality, house number, and a
   conservative street-name similarity threshold.

If the best candidates resolve to more than one point separated by over five
metres, the registry row is quarantined. Coordinates outside Croatia are also
rejected. Every accepted row retains its stable DGU `KB.*` address identifier,
matched source address, matching method, archive hash, and dataset timestamp.

## One-time or manual run

Download `INSPIRE_Addresses_(AD).zip` from the DGU feed, then run:

```powershell
npm run registry:addresses:audit -- --archive C:\path\INSPIRE_Addresses_AD.zip --output C:\temp\dgu-matches.jsonl --unresolved-output C:\temp\dgu-unresolved.json
```

Calculate the downloaded archive SHA-256 and import only the audited output:

```powershell
$hash = (Get-FileHash C:\path\INSPIRE_Addresses_AD.zip -Algorithm SHA256).Hash.ToLowerInvariant()
npm run registry:addresses:import -- --input C:\temp\dgu-matches.jsonl --dataset-updated 2026-08-02T00:00:00Z --archive-sha256 $hash
```

The importer is resumable and uses transactions of at most 500 points. The
database refuses non-current registry IDs, non-Croatian coordinates,
incomplete batches, or a final count that differs from the audited input.

## Production data flow

1. `registry_geocode_batches` records source URL, archive hash, update time,
   counts, and completion state.
2. `registry_dgu_geocode_staging` accepts service-role writes only.
3. `apply_registry_dgu_geocode_batch` promotes at most 500 audited points per
   call and refreshes the current spatial directory projection.
4. `ngo_registry` stores the exact coordinate and complete DGU provenance.
5. Registry-created institution mirrors receive the same coordinate; the
   existing hidden-location trigger still publishes only its privacy-safe
   displaced point when required.
6. `map_association_registry_v2` returns the official street address only for
   points whose public precision is `exact`.

When an association's official headquarters address changes, its old geocode
is invalidated automatically. It remains approximately visible until the next
successful DGU match.

## Verification

After every import, verify all of the following:

- the active registry and national map both still account for 43,703 records;
- the sum of national cluster member counts is 43,703;
- `geocode_source = 'dgu_inspire_addresses'` and
  `geocode_confidence = 'exact'` equals the completed batch count;
- an exact registry-only feature returns its official address and null
  `approximateArea`;
- an unresolved record returns `city` or `county` precision;
- a hidden linked institution never returns its exact coordinate or address.

## If Google is selected later

The supplied Google Cloud project ID is
`project-b7b47004-1822-4880-bfd`. To use it safely, enable billing and the
Geocoding API in that project, create a dedicated restricted server API key,
set a daily API quota and billing-budget alerts, and migrate the displayed map
to Google Maps before using Google-derived coordinates. Never put the server
geocoding key in `NEXT_PUBLIC_*` variables or browser code.

At the currently published price, 43,703 requests in one month use the first
10,000 monthly requests at no charge and cost about USD 168.52 for the
remaining 33,703 requests. The DGU import avoids that spend. Even the remaining
unresolved records should not be sent to Google unless the display/storage
requirements above are accepted.
