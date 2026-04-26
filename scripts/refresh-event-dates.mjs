// Shifts past volunteer_events.event_date values into the future so the
// /volunteer page (which filters event_date >= today) actually shows them.
//
// Strategy: distribute every past event evenly across the next N weeks
// (default 6) starting from tomorrow. Preserves original chronological order
// so the demo dataset still feels like a series of upcoming events. Idempotent
// against future-dated rows (skipped). Updates time fields only when missing.
//
// Usage:
//   node scripts/refresh-event-dates.mjs                 # next 6 weeks
//   node scripts/refresh-event-dates.mjs --weeks 4
//   node scripts/refresh-event-dates.mjs --dry-run

import { supabaseAdmin } from "./lib/supabase-admin.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const argVal = (n, d = null) => {
  const i = args.indexOf(n);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};

const WEEKS = parseInt(argVal("--weeks") || "6");
const DRY = flag("--dry-run");

const today = new Date();
today.setHours(0, 0, 0, 0);
const todayIso = today.toISOString().split("T")[0];

const { data: events, error } = await supabaseAdmin
  .from("volunteer_events")
  .select("id, title, event_date, start_time, end_time")
  .lt("event_date", todayIso)
  .order("event_date", { ascending: true });

if (error) { console.error(error.message); process.exit(1); }

console.log(`Found ${events.length} past events. Distributing across next ${WEEKS} weeks. dry-run=${DRY}`);

if (events.length === 0) { console.log("Nothing to do."); process.exit(0); }

// Spread events across the window starting tomorrow.
const totalDays = WEEKS * 7;
const stride = totalDays / events.length;

let updated = 0;
for (let i = 0; i < events.length; i++) {
  const ev = events[i];
  const offsetDays = Math.max(1, Math.round((i + 1) * stride));
  const newDate = new Date(today);
  newDate.setDate(today.getDate() + offsetDays);
  const newDateIso = newDate.toISOString().split("T")[0];

  const patch = { event_date: newDateIso };
  if (!ev.start_time) patch.start_time = "10:00:00";
  if (!ev.end_time) patch.end_time = "13:00:00";

  console.log(`  ${ev.event_date} → ${newDateIso}  ${ev.title}`);

  if (!DRY) {
    const { error: upErr } = await supabaseAdmin
      .from("volunteer_events")
      .update(patch)
      .eq("id", ev.id);
    if (upErr) {
      console.error(`    update failed: ${upErr.message}`);
      continue;
    }
    updated++;
  }
}

console.log(`\nDone. Updated ${updated}/${events.length} rows.${DRY ? " [dry-run]" : ""}`);
