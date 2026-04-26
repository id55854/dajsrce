// Diagnostic: reports the gap between ngo_registry (raw imports) and
// institutions (what the public site actually shows).
//
// Usage: node scripts/diagnose-registry.mjs

import { supabaseAdmin } from "./lib/supabase-admin.mjs";

async function count(table, filter) {
  let q = supabaseAdmin.from(table).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) {
    console.error(`Error counting ${table}:`, error.message);
    return null;
  }
  return count;
}

console.log("=== Public site source ===");
const totalInst = await count("institutions");
const curated = await count("institutions", (q) => q.eq("source", "curated"));
const fromRegistry = await count("institutions", (q) => q.eq("source", "registry"));
const userClaimed = await count("institutions", (q) => q.eq("source", "user_claimed"));
console.log(`institutions total      : ${totalInst}`);
console.log(`  - source = curated    : ${curated}`);
console.log(`  - source = registry   : ${fromRegistry}`);
console.log(`  - source = user_claimed: ${userClaimed}`);

console.log("\n=== Raw registry import ===");
const totalReg = await count("ngo_registry");
const aktivan = await count("ngo_registry", (q) => q.eq("status", "AKTIVAN"));
console.log(`ngo_registry total      : ${totalReg}`);
console.log(`  - AKTIVAN              : ${aktivan}`);

console.log("\n=== Promotability funnel (AKTIVAN base) ===");
const okOblik = await count("ngo_registry", (q) =>
  q.eq("status", "AKTIVAN").in("oblik_udruzivanja", ["UDRUGA", "SAVEZ UDRUGA"])
);
console.log(`+ oblik UDRUGA/SAVEZ     : ${okOblik}`);

const okCategory = await count("ngo_registry", (q) =>
  q
    .eq("status", "AKTIVAN")
    .in("oblik_udruzivanja", ["UDRUGA", "SAVEZ UDRUGA"])
    .not("mapped_category", "is", null)
    .gte("mapped_confidence", 0.6)
);
console.log(`+ category mapped >=0.6  : ${okCategory}`);

const okGeo = await count("ngo_registry", (q) =>
  q
    .eq("status", "AKTIVAN")
    .in("oblik_udruzivanja", ["UDRUGA", "SAVEZ UDRUGA"])
    .not("mapped_category", "is", null)
    .gte("mapped_confidence", 0.6)
    .not("lat", "is", null)
    .in("geocode_confidence", ["exact", "street"])
);
console.log(`+ geocoded exact/street  : ${okGeo}`);

console.log("\n=== Geocoding state ===");
const geoNull = await count("ngo_registry", (q) => q.is("lat", null));
const geoOk = await count("ngo_registry", (q) => q.not("lat", "is", null));
const geoExact = await count("ngo_registry", (q) => q.eq("geocode_confidence", "exact"));
const geoStreet = await count("ngo_registry", (q) => q.eq("geocode_confidence", "street"));
const geoCity = await count("ngo_registry", (q) => q.eq("geocode_confidence", "city"));
const geoCounty = await count("ngo_registry", (q) => q.eq("geocode_confidence", "county"));
console.log(`lat IS NULL              : ${geoNull}`);
console.log(`lat present              : ${geoOk}`);
console.log(`  - exact                 : ${geoExact}`);
console.log(`  - street                : ${geoStreet}`);
console.log(`  - city  (not eligible)  : ${geoCity}`);
console.log(`  - county (not eligible) : ${geoCounty}`);

console.log("\n=== Category mapping state ===");
const catNull = await count("ngo_registry", (q) => q.is("mapped_category", null));
const catLow = await count("ngo_registry", (q) =>
  q.not("mapped_category", "is", null).lt("mapped_confidence", 0.6)
);
const catOk = await count("ngo_registry", (q) =>
  q.not("mapped_category", "is", null).gte("mapped_confidence", 0.6)
);
console.log(`mapped_category IS NULL   : ${catNull}`);
console.log(`confidence < 0.6          : ${catLow}`);
console.log(`confidence >= 0.6         : ${catOk}`);

console.log("\n=== import_state ===");
const { data: states } = await supabaseAdmin
  .from("import_state")
  .select("job_name, rows_processed, last_run_at, notes");
for (const s of states || []) {
  console.log(`  ${s.job_name}: rows=${s.rows_processed} last=${s.last_run_at}`);
  if (s.notes) {
    try { console.log(`    notes: ${s.notes}`); } catch {}
  }
}

console.log("\n=== Conclusion ===");
console.log(
  `Page reads from 'institutions' (${totalInst} rows). ngo_registry has ${totalReg} raw rows.\n` +
    `Of those, ${okGeo} would qualify for promotion under the default quality bar.\n` +
    `Bottleneck: see funnel above. To make new orgs appear on the map, the\n` +
    `promote-registry.mjs script must run AFTER both category mapping and geocoding.`
);
