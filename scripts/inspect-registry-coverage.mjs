// Database-side coverage report without client row caps or hard-coded totals.

import { supabaseAdmin } from "./lib/supabase-admin.mjs";

const { data: coverage, error } = await supabaseAdmin.rpc("registry_coverage_json");
if (error) throw error;

console.log("=== Registry coverage ===");
console.log(`Total          : ${Number(coverage?.total ?? 0).toLocaleString()}`);
console.log(`Active         : ${Number(coverage?.active ?? 0).toLocaleString()}`);
console.log(`Mapped         : ${Number(coverage?.mapped ?? 0).toLocaleString()}`);
console.log(`Auto-eligible  : ${Number(coverage?.auto_eligible ?? 0).toLocaleString()}`);
console.log(`Needs review   : ${Number(coverage?.needs_review ?? 0).toLocaleString()}`);
console.log(`Geocoded       : ${Number(coverage?.geocoded ?? 0).toLocaleString()}`);
console.log(`Promoted       : ${Number(coverage?.promoted ?? 0).toLocaleString()}`);

console.log("\nBy classification category:");
for (const [category, count] of Object.entries(coverage?.by_category ?? {}).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(7)}  ${category}`);
}

console.log("\nPromoted by region:");
for (const [region, count] of Object.entries(coverage?.by_region_promoted ?? {}).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(7)}  ${region}`);
}
