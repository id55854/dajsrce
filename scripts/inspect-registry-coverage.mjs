// What's left in ngo_registry that we are NOT showing? Breakdown by reason and
// by zupanija + a peek at unmapped names to see what kind of orgs we'd be
// adding if we lowered the bar.

import { supabaseAdmin } from "./lib/supabase-admin.mjs";

async function count(filter) {
  let q = supabaseAdmin.from("ngo_registry").select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) throw error;
  return count;
}

console.log("=== Eligibility ladder (cumulative) ===");
const total = await count();
const a1 = await count((q) => q.eq("status", "AKTIVAN"));
const a2 = await count((q) => q.eq("status", "AKTIVAN").in("oblik_udruzivanja", ["UDRUGA", "SAVEZ UDRUGA"]));
const a3 = await count((q) => q.eq("status", "AKTIVAN").in("oblik_udruzivanja", ["UDRUGA", "SAVEZ UDRUGA"]).not("mapped_category", "is", null));
const a4 = await count((q) => q.eq("status", "AKTIVAN").in("oblik_udruzivanja", ["UDRUGA", "SAVEZ UDRUGA"]).not("mapped_category", "is", null).gte("mapped_confidence", 0.6));
const a5 = await count((q) => q.eq("status", "AKTIVAN").in("oblik_udruzivanja", ["UDRUGA", "SAVEZ UDRUGA"]).not("mapped_category", "is", null).gte("mapped_confidence", 0.6).not("lat", "is", null));
const a6 = await count((q) => q.eq("status", "AKTIVAN").in("oblik_udruzivanja", ["UDRUGA", "SAVEZ UDRUGA"]).not("mapped_category", "is", null).gte("mapped_confidence", 0.6).not("lat", "is", null).in("geocode_confidence", ["exact", "street"]));
const a7 = await count((q) => q.eq("status", "AKTIVAN").in("oblik_udruzivanja", ["UDRUGA", "SAVEZ UDRUGA"]).not("mapped_category", "is", null).gte("mapped_confidence", 0.6).not("lat", "is", null).in("geocode_confidence", ["exact", "street"]).or("mail.not.is.null,web_stranica.not.is.null"));

console.log(`  total                                    ${total}`);
console.log(`  + status=AKTIVAN                         ${a1}`);
console.log(`  + oblik UDRUGA/SAVEZ                     ${a2}`);
console.log(`  + has any mapped_category                ${a3}`);
console.log(`  + confidence >= 0.6                      ${a4}`);
console.log(`  + has lat/lng                            ${a5}`);
console.log(`  + geocode exact/street                   ${a6}`);
console.log(`  + has email or website (FINAL)           ${a7}`);

console.log("\n=== Category breakdown of the unmapped 33,225 ===");
console.log("(top-level: which legal forms these are — sports/cultural/etc. don't map to social-impact categories)");
const { data: unmappedSamples } = await supabaseAdmin
  .from("ngo_registry")
  .select("naziv, oblik_udruzivanja, ciljane_skupine")
  .is("mapped_category", null)
  .eq("status", "AKTIVAN")
  .limit(15);
for (const r of unmappedSamples || []) {
  console.log(`  ${r.naziv?.slice(0, 70)} [${(r.ciljane_skupine || "").slice(0, 40)}]`);
}

console.log("\n=== What sits at confidence 0.4-0.59 (would unlock if we relaxed) ===");
const { data: midConf } = await supabaseAdmin
  .from("ngo_registry")
  .select("naziv, mapped_category, mapped_confidence, mapped_rule")
  .gte("mapped_confidence", 0.4)
  .lt("mapped_confidence", 0.6)
  .eq("status", "AKTIVAN")
  .order("mapped_confidence", { ascending: false })
  .limit(15);
for (const r of midConf || []) {
  console.log(`  ${r.mapped_confidence}  ${r.mapped_category}  ${r.naziv?.slice(0, 60)}  (rule: ${r.mapped_rule})`);
}

console.log("\n=== Currently visible (1,073 promoted) by category ===");
const { data: catCounts } = await supabaseAdmin.rpc("noop_dummy", {}).select();
// Fall back to manual aggregation
const { data: regRows } = await supabaseAdmin
  .from("ngo_registry")
  .select("mapped_category")
  .not("institution_id", "is", null);
const catMap = {};
for (const r of regRows || []) {
  const k = r.mapped_category || "(unknown)";
  catMap[k] = (catMap[k] || 0) + 1;
}
for (const [k, v] of Object.entries(catMap).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k}`);
}

console.log("\n=== By zupanija (promoted only) ===");
const { data: zupRows } = await supabaseAdmin
  .from("ngo_registry")
  .select("zupanija")
  .not("institution_id", "is", null);
const zupMap = {};
for (const r of zupRows || []) {
  const k = r.zupanija || "(none)";
  zupMap[k] = (zupMap[k] || 0) + 1;
}
for (const [k, v] of Object.entries(zupMap).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k}`);
}
