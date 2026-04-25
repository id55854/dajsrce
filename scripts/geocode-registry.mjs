// Geocode public.ngo_registry rows that don't yet have lat/lng.
//
// Default provider: Nominatim (free, 1 req/s). Set GEOCODER=here + HERE_API_KEY
// to use HERE Geocoding (250k/mo free tier).
//
// Resumable: queries only rows where lat IS NULL OR geocoded_at IS NULL,
// ordered by oib. Updates rows in place.
//
// Usage:
//   node scripts/geocode-registry.mjs                       # all ungeocoded
//   node scripts/geocode-registry.mjs --only-promotable     # only mapped/AKTIVAN
//   node scripts/geocode-registry.mjs --limit 200           # smoke test
//   node scripts/geocode-registry.mjs --rps 1               # tune throttle

import { supabaseAdmin, setCursor } from "./lib/supabase-admin.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const argVal = (n, d = null) => {
  const i = args.indexOf(n);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};

const PROVIDER = (process.env.GEOCODER || "nominatim").toLowerCase();
const RPS = parseFloat(argVal("--rps") || process.env.NOMINATIM_RATE_PER_SEC || "1");
const LIMIT = argVal("--limit") ? parseInt(argVal("--limit")) : Infinity;
const ONLY_PROMOTABLE = flag("--only-promotable");
const HERE_KEY = process.env.HERE_API_KEY;
const NOMINATIM_UA = process.env.NOMINATIM_USER_AGENT || "DajSrce/1.0";

const minIntervalMs = Math.ceil(1000 / Math.max(0.1, RPS));

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let lastReqAt = 0;
async function throttle() {
  const elapsed = Date.now() - lastReqAt;
  if (elapsed < minIntervalMs) await sleep(minIntervalMs - elapsed);
  lastReqAt = Date.now();
}

async function geocodeNominatim(query) {
  await throttle();
  const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
    q: query,
    format: "json",
    limit: "1",
    countrycodes: "hr",
    addressdetails: "1",
  }).toString();
  const res = await fetch(url, { headers: { "User-Agent": NOMINATIM_UA, "Accept-Language": "hr,en" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  if (!data || data.length === 0) return null;
  const hit = data[0];
  // crude confidence guess from class/type
  let conf = "city";
  if (hit.address?.house_number) conf = "exact";
  else if (hit.address?.road) conf = "street";
  else if (hit.address?.city || hit.address?.town || hit.address?.village) conf = "city";
  else conf = "county";
  return {
    lat: parseFloat(hit.lat),
    lng: parseFloat(hit.lon),
    confidence: conf,
    source: "nominatim",
  };
}

async function geocodeHere(query) {
  if (!HERE_KEY) throw new Error("HERE_API_KEY missing");
  await throttle();
  const url = "https://geocode.search.hereapi.com/v1/geocode?" + new URLSearchParams({
    q: query,
    in: "countryCode:HRV",
    limit: "1",
    apiKey: HERE_KEY,
  }).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HERE ${res.status}`);
  const data = await res.json();
  if (!data?.items?.[0]) return null;
  const it = data.items[0];
  const t = it.resultType;
  let conf = "city";
  if (t === "houseNumber") conf = "exact";
  else if (t === "street") conf = "street";
  else if (t === "locality" || t === "place") conf = "city";
  else conf = "county";
  return {
    lat: it.position?.lat,
    lng: it.position?.lng,
    confidence: conf,
    source: "here",
  };
}

const geocode = PROVIDER === "here" ? geocodeHere : geocodeNominatim;
console.log(`Geocoder: ${PROVIDER} | rate ≤ ${RPS}/s | only-promotable: ${ONLY_PROMOTABLE} | limit: ${LIMIT === Infinity ? "all" : LIMIT}`);

let processed = 0;
let succeeded = 0;
let fallbacks = 0;
let errors = 0;
const t0 = Date.now();

while (processed < LIMIT) {
  const PAGE = 200;
  let q = supabaseAdmin
    .from("ngo_registry")
    .select("oib, naziv, sjediste, city, zupanija, status, mapped_category, mapped_confidence, geocode_confidence, lat, lng")
    .is("lat", null)
    .order("oib", { ascending: true })
    .limit(PAGE);

  if (ONLY_PROMOTABLE) {
    q = q.eq("status", "AKTIVAN").not("mapped_category", "is", null).gte("mapped_confidence", 0.6);
  }

  const { data, error } = await q;
  if (error) { console.error("Fetch error:", error.message); break; }
  if (!data || data.length === 0) { console.log("No more rows to geocode."); break; }

  for (const row of data) {
    if (processed >= LIMIT) break;
    processed++;

    // Try most-specific query first.
    const queries = [];
    if (row.sjediste) queries.push(row.sjediste);
    if (row.city)     queries.push(`${row.city}, Hrvatska`);
    if (row.zupanija) queries.push(`${row.zupanija}, Hrvatska`);

    let result = null;
    let lastError = null;
    for (const q of queries) {
      try {
        result = await geocode(q);
        if (result) break;
      } catch (e) {
        lastError = e;
        // backoff and try next
        await sleep(1000);
      }
    }

    const update = result
      ? {
          lat: result.lat,
          lng: result.lng,
          geocode_source: result.source,
          geocode_confidence: result.confidence,
          geocoded_at: new Date().toISOString(),
        }
      : {
          // Mark as attempted so we don't retry on every run.
          geocode_source: PROVIDER,
          geocode_confidence: null,
          geocoded_at: new Date().toISOString(),
        };

    const { error: upErr } = await supabaseAdmin
      .from("ngo_registry")
      .update(update)
      .eq("oib", row.oib);
    if (upErr) {
      console.error(`Update failed for ${row.oib}:`, upErr.message);
      errors++;
    } else if (result) {
      succeeded++;
      if (result.confidence === "city" || result.confidence === "county") fallbacks++;
    }

    if (processed % 50 === 0) {
      const dt = ((Date.now() - t0) / 1000).toFixed(0);
      const rate = (processed / Math.max(1, dt)).toFixed(2);
      console.log(`  processed=${processed} ok=${succeeded} fb=${fallbacks} err=${errors} | ${rate}/s | last: ${row.naziv?.slice(0, 60)}`);
    }
    if (lastError) {
      // soft-warn; don't spam
    }
  }

  // small page-level pause
  await sleep(50);
}

await setCursor("geocode-registry", new Date().toISOString(), processed, JSON.stringify({
  provider: PROVIDER,
  succeeded,
  fallbacks,
  errors,
}));

console.log("\n=== Geocode report ===");
console.log(`Processed       : ${processed.toLocaleString()}`);
console.log(`Resolved        : ${succeeded.toLocaleString()}`);
console.log(`Fallbacks (city/county): ${fallbacks.toLocaleString()}`);
console.log(`Errors          : ${errors}`);
console.log(`Elapsed         : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
