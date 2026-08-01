// Durable registry geocoding queue with bounded retries and backoff.

import { supabaseAdmin, setCursor } from "./lib/supabase-admin.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argVal = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};

const PROVIDER = (process.env.GEOCODER || "nominatim").toLowerCase();
const requestedRps = Number.parseFloat(argVal("--rps") || process.env.NOMINATIM_RATE_PER_SEC || "1");
const RPS = PROVIDER === "nominatim" ? Math.min(1, requestedRps) : Math.min(20, requestedRps);
const LIMIT = argVal("--limit") ? Number.parseInt(argVal("--limit"), 10) : Number.POSITIVE_INFINITY;
const ONLY_PROMOTABLE = flag("--only-promotable");
const HERE_KEY = process.env.HERE_API_KEY;
const NOMINATIM_UA = process.env.NOMINATIM_USER_AGENT;
const MAX_ATTEMPTS = Math.min(10, Math.max(1, Number.parseInt(process.env.GEOCODE_MAX_ATTEMPTS || "5", 10)));

if (!Number.isFinite(RPS) || RPS <= 0) throw new Error("Geocoder RPS must be positive");
if (PROVIDER === "here" && !HERE_KEY) throw new Error("HERE_API_KEY is required when GEOCODER=here");
if (
  PROVIDER === "nominatim" &&
  (!NOMINATIM_UA || (!NOMINATIM_UA.includes("http") && !NOMINATIM_UA.includes("@")))
) {
  throw new Error(
    "NOMINATIM_USER_AGENT must identify DajSrce and include a contact URL or email"
  );
}

const minimumIntervalMs = Math.ceil(1000 / RPS);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let lastRequestAt = 0;

async function throttle() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < minimumIntervalMs) await sleep(minimumIntervalMs - elapsed);
  lastRequestAt = Date.now();
}

async function geocodeNominatim(query) {
  await throttle();
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q: query,
    format: "json",
    limit: "1",
    countrycodes: "hr",
    addressdetails: "1",
  })}`;
  const response = await fetch(url, {
    headers: { "User-Agent": NOMINATIM_UA, "Accept-Language": "hr,en" },
  });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const hit = data[0];
  const confidence = hit.address?.house_number
    ? "exact"
    : hit.address?.road
      ? "street"
      : hit.address?.city || hit.address?.town || hit.address?.village
        ? "city"
        : "county";
  return { lat: Number(hit.lat), lng: Number(hit.lon), confidence, source: "nominatim" };
}

async function geocodeHere(query) {
  await throttle();
  const url = `https://geocode.search.hereapi.com/v1/geocode?${new URLSearchParams({
    q: query,
    in: "countryCode:HRV",
    limit: "1",
    apiKey: HERE_KEY,
  })}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HERE HTTP ${response.status}`);
  const data = await response.json();
  const hit = data?.items?.[0];
  if (!hit) return null;
  const confidence = hit.resultType === "houseNumber"
    ? "exact"
    : hit.resultType === "street"
      ? "street"
      : ["locality", "place"].includes(hit.resultType)
        ? "city"
        : "county";
  return { lat: Number(hit.position?.lat), lng: Number(hit.position?.lng), confidence, source: "here" };
}

const geocode = PROVIDER === "here" ? geocodeHere : geocodeNominatim;
console.log(`Geocoder: ${PROVIDER} | rate <= ${RPS}/s | max attempts: ${MAX_ATTEMPTS}`);

let processed = 0;
let succeeded = 0;
let fallbackQuality = 0;
let retryableFailed = 0;
let permanentFailed = 0;
let updateErrors = 0;
const startedAt = Date.now();

while (processed < LIMIT) {
  const now = new Date().toISOString();
  const pageSize = Math.min(200, Number.isFinite(LIMIT) ? LIMIT - processed : 200);
  let query = supabaseAdmin
    .from("ngo_registry")
    .select(
      "oib, naziv, sjediste, city, zupanija, status, classification_status, mapped_confidence, geocode_status, geocode_attempts"
    )
    .in("geocode_status", ["pending", "retryable_failed"])
    .or(`next_geocode_attempt_at.is.null,next_geocode_attempt_at.lte.${now}`)
    .order("oib", { ascending: true })
    .limit(pageSize);
  if (ONLY_PROMOTABLE) {
    query = query
      .eq("status", "AKTIVAN")
      .eq("classification_status", "auto_eligible")
      .gte("mapped_confidence", 0.7);
  }

  const { data: rows, error: fetchError } = await query;
  if (fetchError) throw fetchError;
  if (!rows?.length) break;

  for (const row of rows) {
    if (processed >= LIMIT) break;
    const attempt = Number(row.geocode_attempts ?? 0) + 1;
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from("ngo_registry")
      .update({
        geocode_status: "in_progress",
        geocode_attempts: attempt,
        last_geocode_error: null,
        next_geocode_attempt_at: null,
      })
      .eq("oib", row.oib)
      .eq("geocode_status", row.geocode_status)
      .select("oib")
      .maybeSingle();
    if (claimError || !claimed) continue;
    processed += 1;

    const queries = [
      row.sjediste,
      row.city ? `${row.city}, Hrvatska` : null,
      row.zupanija ? `${row.zupanija}, Hrvatska` : null,
    ].filter(Boolean);
    let result = null;
    let lastError = null;
    for (const address of queries) {
      try {
        result = await geocode(address);
        if (result) break;
      } catch (error) {
        lastError = error;
        break; // provider errors are retryable; do not multiply requests
      }
    }

    let update;
    if (result && Number.isFinite(result.lat) && Number.isFinite(result.lng)) {
      update = {
        lat: result.lat,
        lng: result.lng,
        geocode_source: result.source,
        geocode_confidence: result.confidence,
        geocoded_at: new Date().toISOString(),
        geocode_status: "succeeded",
        next_geocode_attempt_at: null,
        last_geocode_error: null,
      };
      succeeded += 1;
      if (["city", "county"].includes(result.confidence)) fallbackQuality += 1;
    } else {
      const noMatch = !lastError;
      const isPermanent = attempt >= (noMatch ? Math.min(3, MAX_ATTEMPTS) : MAX_ATTEMPTS);
      const backoffMinutes = Math.min(24 * 60, 2 ** Math.min(attempt, 10));
      update = {
        geocode_source: PROVIDER,
        geocode_confidence: null,
        geocoded_at: new Date().toISOString(),
        geocode_status: isPermanent ? "permanent_failed" : "retryable_failed",
        next_geocode_attempt_at: isPermanent
          ? null
          : new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
        last_geocode_error: noMatch
          ? "No provider result"
          : String(lastError instanceof Error ? lastError.message : lastError).slice(0, 1000),
      };
      if (isPermanent) permanentFailed += 1;
      else retryableFailed += 1;
    }

    const { error: updateError } = await supabaseAdmin
      .from("ngo_registry")
      .update(update)
      .eq("oib", row.oib)
      .eq("geocode_status", "in_progress");
    if (updateError) {
      updateErrors += 1;
      console.error(`Update failed for ${row.oib}: ${updateError.message}`);
    }

    if (processed % 25 === 0) {
      console.log(
        `  processed=${processed} ok=${succeeded} retry=${retryableFailed} permanent=${permanentFailed}`
      );
    }
  }
}

await setCursor("geocode-registry", new Date().toISOString(), processed, JSON.stringify({
  provider: PROVIDER,
  succeeded,
  fallbackQuality,
  retryableFailed,
  permanentFailed,
  updateErrors,
}));

console.log("\n=== Geocode report ===");
console.log(`Processed        : ${processed.toLocaleString()}`);
console.log(`Resolved         : ${succeeded.toLocaleString()}`);
console.log(`City/county only : ${fallbackQuality.toLocaleString()}`);
console.log(`Retryable failed : ${retryableFailed.toLocaleString()}`);
console.log(`Permanent failed : ${permanentFailed.toLocaleString()}`);
console.log(`Update errors    : ${updateErrors.toLocaleString()}`);
console.log(`Elapsed          : ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
