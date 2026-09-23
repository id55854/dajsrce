// Classify official-registry organisations with TypeSafe's Jev and publish the
// result through apply_registry_classifications (which also refreshes the
// current snapshot's directory rows, so the map changes immediately).
//
//   npm run registry:classify                 rows not yet on the current Jev version
//   npm run registry:classify -- --all        every row, even if already classified
//   npm run registry:classify -- --limit 200  bounded run
//   npm run registry:classify -- --dry-run    classify and report, write nothing
//   npm run registry:classify -- --eval       score the rubric against the hand-labelled
//                                             sample in data/registry-classification-gold.json
//
// Needs TYPESAFE_API_KEY plus the Data API credentials scripts use.

import fs from "node:fs";
import path from "node:path";
import { supabaseAdmin } from "./lib/supabase-admin.mjs";
import {
  JEV_CLASSIFICATION_VERSION,
  classifyWithJev,
  mapConcurrent,
  toClassification,
} from "./lib/jev-classifier.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argVal = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const limit = argVal("--limit") ? Number.parseInt(argVal("--limit"), 10) : Number.POSITIVE_INFINITY;
const concurrency = Number.parseInt(argVal("--concurrency", "16"), 10);
const dryRun = flag("--dry-run");
const all = flag("--all");
const PAGE = 400;
const COLUMNS = "udr_id, naziv, ciljevi, opis_djelatnosti, ciljane_skupine";

async function evaluate() {
  const goldPath = path.join(process.cwd(), "data", "registry-classification-gold.json");
  const gold = JSON.parse(fs.readFileSync(goldPath, "utf8"));
  const byId = new Map(gold.map((entry) => [entry.udr_id, entry]));
  const rows = [];
  for (let i = 0; i < gold.length; i += 200) {
    const ids = gold.slice(i, i + 200).map((entry) => entry.udr_id);
    const { data, error } = await supabaseAdmin.from("ngo_registry").select(COLUMNS).in("udr_id", ids);
    if (error) throw error;
    rows.push(...data);
  }
  const answers = await mapConcurrent(rows, concurrency, (row) => classifyWithJev(row));
  const scored = rows.map((row, i) => {
    const result = toClassification(row, answers[i]);
    const shown = result.classification_status === "auto_eligible" ? result.mapped_category : "association";
    return { ...byId.get(row.udr_id), shown, raw: answers[i].choice };
  });
  for (const split of ["dev", "test", "all"]) {
    const set = scored.filter((entry) => split === "all" || entry.split === split);
    const shownCare = set.filter((entry) => entry.shown !== "association");
    const trueCare = set.filter((entry) => entry.label !== "association");
    const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : "-");
    console.log(
      `${split.padEnd(4)} n=${String(set.length).padStart(3)}  accuracy ${pct(set.filter((e) => e.shown === e.label).length, set.length)}%  ` +
        `care precision ${pct(shownCare.filter((e) => e.shown === e.label).length, shownCare.length)}% (n=${shownCare.length})  ` +
        `care recall ${pct(trueCare.filter((e) => e.shown === e.label).length, trueCare.length)}% (n=${trueCare.length})`
    );
  }
}

async function run() {
  let scanned = 0;
  let written = 0;
  let tokens = 0;
  let afterUdrId = "";
  const distribution = {};
  const startedAt = Date.now();

  while (scanned < limit) {
    let query = supabaseAdmin
      .from("ngo_registry")
      .select(COLUMNS)
      .eq("source_present", true)
      .order("udr_id", { ascending: true })
      .limit(Math.min(PAGE, Number.isFinite(limit) ? limit - scanned : PAGE));
    if (!all) query = query.or(`classification_version.is.null,classification_version.neq.\"${JEV_CLASSIFICATION_VERSION}\"`);
    if (afterUdrId) query = query.gt("udr_id", afterUdrId);
    const { data: rows, error } = await query;
    if (error) throw error;
    if (!rows?.length) break;

    const answers = await mapConcurrent(rows, concurrency, (row) => classifyWithJev(row));
    const updates = rows.map((row, i) => {
      tokens += answers[i].inputTokens;
      const result = toClassification(row, answers[i]);
      const key = result.classification_status === "auto_eligible" ? result.mapped_category : result.classification_status;
      distribution[key] = (distribution[key] || 0) + 1;
      return result;
    });

    if (!dryRun) {
      for (let i = 0; i < updates.length; i += 200) {
        const { data: affected, error: updateError } = await supabaseAdmin.rpc("apply_registry_classifications", {
          p_rows: updates.slice(i, i + 200),
        });
        if (updateError) throw updateError;
        written += Number(affected ?? 0);
      }
    }
    scanned += rows.length;
    afterUdrId = rows.at(-1).udr_id;
    const perMinute = Math.round((scanned / (Date.now() - startedAt)) * 60_000);
    console.log(`  classified ${scanned.toLocaleString()} rows (${perMinute}/min, ${tokens.toLocaleString()} tokens)`);
  }

  console.log(`\n=== Jev classification ${dryRun ? "(dry run) " : ""}===`);
  console.log(`Version : ${JEV_CLASSIFICATION_VERSION}`);
  console.log(`Scanned : ${scanned.toLocaleString()}`);
  console.log(`Written : ${written.toLocaleString()}`);
  console.log(`Tokens  : ${tokens.toLocaleString()}`);
  for (const [key, count] of Object.entries(distribution).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(7)}  ${key}`);
  }
}

if (!process.env.TYPESAFE_API_KEY) {
  console.error("Missing TYPESAFE_API_KEY in .env.local or the environment");
  process.exit(1);
}
await (flag("--eval") ? evaluate() : run());
