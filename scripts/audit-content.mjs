// Lists every `needs` and `volunteer_events` row so a human can pick out
// seed/demo content by eye, then deletes exactly the rows named by id.
// Deliberately does not guess at "looks like seed data" — a wrong guess here
// deletes someone's real donation ask. The `maybe-seed` hint is a pointer for
// the human doing the picking, never the deletion criterion.
//
// Usage:
//   node scripts/audit-content.mjs
//   node scripts/audit-content.mjs --delete-needs <id1>,<id2>
//   node scripts/audit-content.mjs --delete-events <id1>,<id2>
//   node scripts/audit-content.mjs --delete-needs <id1> --delete-events <id2>
//
// Deleting a need cascades to its pledges; deleting an event cascades to its
// volunteer signups (both `on delete cascade` in 001_initial_schema.sql).

import { supabaseAdmin } from "./lib/supabase-admin.mjs";

const args = process.argv.slice(2);
function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
function argIds(name) {
  const raw = argValue(name);
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A rough, human-facing hint only: no Croatian diacritic anywhere in the
// title is common for hand-typed English placeholder copy. Real Croatian
// NGO titles almost always carry at least one č/ć/đ/š/ž.
function maybeSeedHint(title) {
  return !/[čćđšž]/i.test(title) ? " ⚑ maybe-seed (no HR diacritics)" : "";
}

async function listNeeds() {
  const { data, error } = await supabaseAdmin
    .from("needs")
    .select("id, title, urgency, created_at, institution:institutions(name)")
    .order("created_at", { ascending: true });
  if (error) throw error;
  console.log(`\n=== needs (${data.length}) ===`);
  for (const row of data) {
    const inst = row.institution?.name ?? "(unknown institution)";
    const date = row.created_at?.slice(0, 10) ?? "?";
    console.log(
      `${row.id}  ${date}  [${row.urgency}]  ${inst} — "${row.title}"${maybeSeedHint(row.title)}`
    );
  }
  return data;
}

async function listVolunteerEvents() {
  const { data, error } = await supabaseAdmin
    .from("volunteer_events")
    .select("id, title, event_date, created_at, institution:institutions(name)")
    .order("created_at", { ascending: true });
  if (error) throw error;
  console.log(`\n=== volunteer_events (${data.length}) ===`);
  for (const row of data) {
    const inst = row.institution?.name ?? "(unknown institution)";
    console.log(
      `${row.id}  event ${row.event_date}  ${inst} — "${row.title}"${maybeSeedHint(row.title)}`
    );
  }
  return data;
}

async function deleteByIds(table, ids) {
  if (ids.length === 0) return;
  const bad = ids.filter((id) => !UUID_RE.test(id));
  if (bad.length) throw new Error(`Not a uuid, refusing to touch ${table}: ${bad.join(", ")}`);

  const { data: existing, error: findErr } = await supabaseAdmin
    .from(table)
    .select("id, title")
    .in("id", ids);
  if (findErr) throw findErr;

  const found = new Set(existing.map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new Error(`${table}: id(s) not found, nothing deleted: ${missing.join(", ")}`);
  }

  console.log(`\nDeleting ${existing.length} row(s) from ${table}:`);
  for (const row of existing) console.log(`  ${row.id}  "${row.title}"`);

  const { error: delErr } = await supabaseAdmin.from(table).delete().in("id", ids);
  if (delErr) throw delErr;
  console.log(`Deleted ${existing.length} row(s) from ${table}.`);
}

const deleteNeeds = argIds("--delete-needs");
const deleteEvents = argIds("--delete-events");

if (deleteNeeds.length === 0 && deleteEvents.length === 0) {
  await listNeeds();
  await listVolunteerEvents();
  console.log(
    "\nNothing deleted (list-only run). Re-run with --delete-needs <id,...> and/or " +
      "--delete-events <id,...> once you've picked the rows to remove."
  );
} else {
  await deleteByIds("needs", deleteNeeds);
  await deleteByIds("volunteer_events", deleteEvents);
}
