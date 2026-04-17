import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. in .env.local)");
  process.exit(1);
}

const supabase = createClient(url, key);

const { INSTITUTIONS } = await import("../src/lib/institutions-seed.ts");
const { buildSampleNeeds, buildSampleVolunteerEvents } = await import(
  "../src/lib/seed-sample-content.ts"
);

console.log(`Clearing institutions (cascades needs, events, pledges where linked)...`);

const { error: delErr } = await supabase
  .from("institutions")
  .delete()
  .neq("id", "00000000-0000-0000-0000-000000000000");

if (delErr) {
  console.error("Delete failed:", delErr.message);
  process.exit(1);
}

console.log(`Seeding ${INSTITUTIONS.length} institutions...`);

const { data: inserted, error } = await supabase
  .from("institutions")
  .insert(
    INSTITUTIONS.map((inst) => ({
      ...inst,
      is_verified: true,
      photo_url: null,
    }))
  )
  .select("id, category");

if (error) {
  console.error("Error seeding institutions:", error.message);
  process.exit(1);
}

console.log(`Seeded ${inserted?.length ?? 0} institutions.`);

if (inserted?.length) {
  const refs = inserted.map((row) => ({
    id: row.id,
    category: row.category,
  }));

  const needs = buildSampleNeeds(refs);
  const { error: needsErr } = await supabase.from("needs").insert(needs);
  if (needsErr) {
    console.error("Needs insert failed:", needsErr.message);
    process.exit(1);
  }
  console.log(`Seeded ${needs.length} needs.`);

  const events = buildSampleVolunteerEvents(refs, new Date());
  const { error: evErr } = await supabase.from("volunteer_events").insert(events);
  if (evErr) {
    console.error("Volunteer events insert failed:", evErr.message);
    process.exit(1);
  }
  console.log(`Seeded ${events.length} volunteer events.`);
}

console.log("Done.");
