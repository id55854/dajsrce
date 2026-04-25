// Re-apply category-rules.mjs to existing ngo_registry rows in place.
// Use after iterating on the rule set; doesn't touch geocoding or contact info.
//
// Usage:
//   node scripts/remap-categories.mjs
//   node scripts/remap-categories.mjs --limit 1000

import { supabaseAdmin } from "./lib/supabase-admin.mjs";
import { scoreRow } from "./lib/category-rules.mjs";

const args = process.argv.slice(2);
const argVal = (n, d = null) => {
  const i = args.indexOf(n);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};
const LIMIT = argVal("--limit") ? parseInt(argVal("--limit")) : Infinity;

let scanned = 0;
let changed = 0;
const PAGE = 500;
let from = 0;
const dist = {};

while (scanned < LIMIT) {
  const { data, error } = await supabaseAdmin
    .from("ngo_registry")
    .select("oib, naziv, ciljane_skupine, opis_djelatnosti, ciljevi, mapped_category, mapped_confidence")
    .order("oib", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw error;
  if (!data || data.length === 0) break;

  for (const r of data) {
    if (scanned >= LIMIT) break;
    scanned++;
    const score = scoreRow({
      groups: r.ciljane_skupine || "",
      text: `${r.opis_djelatnosti || ""}\n${r.ciljevi || ""}`,
      name: r.naziv || "",
    });
    dist[score.category || "__unmapped"] = (dist[score.category || "__unmapped"] || 0) + 1;
    if (
      score.category !== r.mapped_category ||
      score.confidence !== Number(r.mapped_confidence)
    ) {
      const { error: ue } = await supabaseAdmin
        .from("ngo_registry")
        .update({
          mapped_category: score.category,
          mapped_confidence: score.confidence,
          mapped_rule: score.rule,
        })
        .eq("oib", r.oib);
      if (!ue) changed++;
    }
  }
  from += PAGE;
  if (data.length < PAGE) break;
  if (scanned % 5000 === 0) console.log(`  ... scanned ${scanned}`);
}

console.log(`\nScanned : ${scanned}`);
console.log(`Changed : ${changed}`);
console.log("\nNew category distribution:");
for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(6)}  ${k}`);
}
