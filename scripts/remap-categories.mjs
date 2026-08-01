// Reclassify registry records in bounded reads and set-based update batches.

import { supabaseAdmin } from "./lib/supabase-admin.mjs";
import { scoreRow, inferAcceptsDonations } from "./lib/category-rules.mjs";

const args = process.argv.slice(2);
const argVal = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const limit = argVal("--limit") ? Number.parseInt(argVal("--limit"), 10) : Number.POSITIVE_INFINITY;
const pageSize = 500;
let scanned = 0;
let changed = 0;
let afterOib = "";
const distribution = {};

while (scanned < limit) {
  const take = Math.min(pageSize, Number.isFinite(limit) ? limit - scanned : pageSize);
  let query = supabaseAdmin
    .from("ngo_registry")
    .select("oib, naziv, ciljane_skupine, opis_djelatnosti, ciljevi")
    .order("oib", { ascending: true })
    .limit(take);
  if (afterOib) query = query.gt("oib", afterOib);
  const { data: rows, error } = await query;
  if (error) throw error;
  if (!rows?.length) break;

  const updates = rows.map((row) => {
    const activityText = `${row.opis_djelatnosti || ""}\n${row.ciljevi || ""}`;
    const score = scoreRow({
      groups: row.ciljane_skupine || "",
      text: activityText,
      name: row.naziv || "",
    });
    distribution[score.classificationStatus] =
      (distribution[score.classificationStatus] || 0) + 1;
    return {
      oib: row.oib,
      mapped_category: score.category,
      mapped_confidence: score.confidence,
      mapped_rule: score.rule,
      classification_status: score.classificationStatus,
      classification_reasons: score.reviewReasons,
      classification_candidates: score.candidateCategories,
      classification_version: score.classificationVersion,
      donation_candidates: inferAcceptsDonations(
        score.category,
        `${activityText}\n${row.ciljane_skupine || ""}`
      ),
    };
  });

  const { data: affected, error: updateError } = await supabaseAdmin.rpc(
    "apply_registry_classifications",
    { p_rows: updates }
  );
  if (updateError) throw updateError;
  changed += Number(affected ?? 0);
  scanned += rows.length;
  afterOib = rows.at(-1).oib;
  console.log(`  classified ${scanned.toLocaleString()} rows`);
}

console.log("\n=== Classification report ===");
console.log(`Scanned : ${scanned.toLocaleString()}`);
console.log(`Updated : ${changed.toLocaleString()}`);
for (const [status, count] of Object.entries(distribution).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(7)}  ${status}`);
}
