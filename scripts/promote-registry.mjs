// Promote qualifying ngo_registry rows into public.institutions.
//
// Quality bar:
//   * status = AKTIVAN
//   * oblik_udruzivanja in (UDRUGA, SAVEZ UDRUGA)
//   * mapped_category not null AND mapped_confidence >= 0.6
//   * lat/lng present AND geocode_confidence in (exact, street)
//   * has at least one contact channel: mail OR web_stranica
//
// Idempotent: if a registry row already has institution_id set, we update the
// linked row in place (when source != 'curated'). Curated rows are NEVER
// touched.
//
// Usage:
//   node scripts/promote-registry.mjs                 # all qualifying
//   node scripts/promote-registry.mjs --dry-run       # report only
//   node scripts/promote-registry.mjs --limit 500
//   node scripts/promote-registry.mjs --min-confidence 0.7

import { supabaseAdmin } from "./lib/supabase-admin.mjs";
import { derivedServedPopulation, inferAcceptsDonations } from "./lib/category-rules.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const argVal = (n, d = null) => {
  const i = args.indexOf(n);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};

const DRY = flag("--dry-run");
const LIMIT = argVal("--limit") ? parseInt(argVal("--limit")) : Infinity;
const MIN_CONF = parseFloat(argVal("--min-confidence") || "0.6");
const ALLOWED_GEOCODE = new Set(["exact", "street"]);

console.log(`Promote: dry-run=${DRY} | min-confidence=${MIN_CONF} | limit=${LIMIT === Infinity ? "all" : LIMIT}`);

let inserted = 0;
let updated = 0;
let skipped = 0;
let scanned = 0;
const reasonCounts = {};
function bump(r) { reasonCounts[r] = (reasonCounts[r] || 0) + 1; }

const PAGE = 500;
let from = 0;

while (scanned < LIMIT) {
  const { data, error } = await supabaseAdmin
    .from("ngo_registry")
    .select("oib, naziv, skraceni_naziv, sjediste, city, zupanija, mail, web_stranica, status, oblik_udruzivanja, mapped_category, mapped_confidence, ciljane_skupine, opis_djelatnosti, lat, lng, geocode_confidence, institution_id")
    .order("oib", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw error;
  if (!data || data.length === 0) break;

  for (const r of data) {
    if (scanned >= LIMIT) break;
    scanned++;

    if (r.status !== "AKTIVAN") { bump("not_active"); skipped++; continue; }
    if (!["UDRUGA", "SAVEZ UDRUGA"].includes((r.oblik_udruzivanja || "").trim())) { bump("wrong_oblik"); skipped++; continue; }
    if (!r.mapped_category) { bump("no_category"); skipped++; continue; }
    if ((r.mapped_confidence ?? 0) < MIN_CONF) { bump("low_confidence"); skipped++; continue; }
    if (r.lat == null || r.lng == null) { bump("no_geocode"); skipped++; continue; }
    if (!ALLOWED_GEOCODE.has(r.geocode_confidence)) { bump("geocode_too_loose"); skipped++; continue; }
    if (!r.mail && !r.web_stranica) { bump("no_contact"); skipped++; continue; }

    const description = (r.opis_djelatnosti || "").slice(0, 4000) || (r.naziv || "");
    const served = derivedServedPopulation(r.ciljane_skupine);
    const accepts = inferAcceptsDonations(r.mapped_category, `${r.opis_djelatnosti || ""} ${r.ciljane_skupine || ""}`);
    const city = r.city || (r.zupanija || "").replace(/^Grad\s+/, "") || "Zagreb";

    const payload = {
      name: r.naziv,
      category: r.mapped_category,
      description,
      address: r.sjediste || `${city}, Hrvatska`,
      city,
      lat: r.lat,
      lng: r.lng,
      phone: null,
      email: r.mail || null,
      website: r.web_stranica || null,
      working_hours: null,
      drop_off_hours: null,
      accepts_donations: accepts,
      capacity: null,
      served_population: served,
      photo_url: null,
      is_verified: false,
      is_location_hidden: false,
      approximate_area: null,
      nearest_zet_stop: null,
      zet_lines: null,
      source: "registry",
      registry_oib: r.oib,
    };

    if (DRY) {
      bump("would_insert");
      inserted++;
      continue;
    }

    if (r.institution_id) {
      // Re-promote — only update non-curated rows.
      const { data: existing, error: ee } = await supabaseAdmin
        .from("institutions").select("id, source").eq("id", r.institution_id).maybeSingle();
      if (ee) { console.error(ee.message); skipped++; continue; }
      if (!existing) {
        // Stale link — clear and insert fresh.
        const ins = await supabaseAdmin.from("institutions").insert(payload).select("id").single();
        if (ins.error) { console.error("insert", ins.error.message); skipped++; continue; }
        await supabaseAdmin.from("ngo_registry").update({ institution_id: ins.data.id }).eq("oib", r.oib);
        inserted++;
        continue;
      }
      if (existing.source === "curated") { bump("linked_to_curated"); skipped++; continue; }
      const upd = await supabaseAdmin.from("institutions").update(payload).eq("id", r.institution_id);
      if (upd.error) { console.error("update", upd.error.message); skipped++; continue; }
      updated++;
    } else {
      // Try to find an existing curated row by OIB (institutions has `oib` column from migration 005).
      let linkedId = null;
      const { data: byOib } = await supabaseAdmin
        .from("institutions").select("id, source").eq("oib", r.oib).maybeSingle();
      if (byOib) {
        if (byOib.source === "curated") {
          // Just attach the link, never overwrite curated content.
          await supabaseAdmin.from("ngo_registry").update({ institution_id: byOib.id }).eq("oib", r.oib);
          bump("linked_existing_curated");
          skipped++;
          continue;
        }
        linkedId = byOib.id;
      }

      if (linkedId) {
        const upd = await supabaseAdmin.from("institutions").update(payload).eq("id", linkedId);
        if (upd.error) { console.error("update", upd.error.message); skipped++; continue; }
        await supabaseAdmin.from("ngo_registry").update({ institution_id: linkedId }).eq("oib", r.oib);
        updated++;
      } else {
        const ins = await supabaseAdmin.from("institutions").insert({ ...payload, oib: r.oib }).select("id").single();
        if (ins.error) { console.error("insert", ins.error.message); skipped++; continue; }
        await supabaseAdmin.from("ngo_registry").update({ institution_id: ins.data.id }).eq("oib", r.oib);
        inserted++;
      }
    }

    if ((inserted + updated) % 200 === 0) {
      console.log(`  ... inserted=${inserted} updated=${updated} skipped=${skipped} scanned=${scanned}`);
    }
  }

  from += PAGE;
  if (data.length < PAGE) break;
}

console.log("\n=== Promote report ===");
console.log(`Scanned   : ${scanned.toLocaleString()}`);
console.log(`Inserted  : ${inserted.toLocaleString()}`);
console.log(`Updated   : ${updated.toLocaleString()}`);
console.log(`Skipped   : ${skipped.toLocaleString()}`);
console.log("\nSkip reasons:");
for (const [k, v] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(6)}  ${k}`);
}
if (DRY) console.log("\n[DRY RUN] no rows written.");
