// Import RegistarUdruga.csv → public.ngo_registry.
//
// Streams the CSV (multi-line quoted fields, ~70k rows), normalizes columns,
// applies category rules, and upserts batches of 500 on (oib).
//
// Idempotent: re-running updates rows in place. Resumable via import_state.
//
// Usage:
//   node scripts/import-registry.mjs                    # all rows
//   node scripts/import-registry.mjs --zg               # only Grad Zagreb
//   node scripts/import-registry.mjs --active-only      # default true
//   node scripts/import-registry.mjs --limit 1000       # for smoke test
//   node scripts/import-registry.mjs --dry-run

import fs from "node:fs";
import path from "node:path";
import { parseCsvStream } from "./lib/csv-stream.mjs";
import { scoreRow, parseSjediste } from "./lib/category-rules.mjs";
import { supabaseAdmin, getCursor, setCursor } from "./lib/supabase-admin.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argVal = (name, def = null) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

const CSV_PATH =
  argVal("--csv") ||
  process.env.REGISTRY_CSV_PATH ||
  path.resolve(process.cwd(), "RegistarUdruga.csv") ||
  path.resolve(process.cwd(), "../RegistarUdruga.csv");

const ONLY_ZG = flag("--zg");
const ACTIVE_ONLY = !flag("--include-inactive"); // default: AKTIVAN only
const DRY_RUN = flag("--dry-run");
const LIMIT = argVal("--limit") ? parseInt(argVal("--limit")) : Infinity;
const BATCH_BATCH_ID = `import-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;

if (!fs.existsSync(CSV_PATH)) {
  console.error(`CSV not found at ${CSV_PATH}`);
  console.error("Set --csv <path> or REGISTRY_CSV_PATH env var.");
  process.exit(1);
}

console.log(`Importing from: ${CSV_PATH}`);
console.log(`Filter: ${ACTIVE_ONLY ? "AKTIVAN only" : "ALL statuses"} | ZG only: ${ONLY_ZG} | dry-run: ${DRY_RUN} | batch: ${BATCH_BATCH_ID}`);

function parseDate(s) {
  if (!s) return null;
  // CSV format: "M/D/YYYY 12:00:00 AM"
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function rowToRegistry(o) {
  const sjediste = (o.SJEDISTE || "").trim();
  const { street, city } = parseSjediste(sjediste);

  const groups = (o.CILJANE_SKUPINE || "").trim();
  const text = `${o.OPIS_DJELATNOSTI || ""}\n${o.CILJEVI || ""}`.trim();
  const name = (o.NAZIV || "").trim();

  const score = scoreRow({ groups, text, name });

  return {
    oib: (o.OIB || "").trim(),
    mail: (o.MAIL || "").trim() || null,
    naziv: name,
    status: (o.STATUS || "").trim(),
    udr_id: (o.UDR_ID || "").trim() || null,
    ciljevi: (o.CILJEVI || "").trim() || null,
    sjediste: sjediste || null,
    zupanija: (o.ZUPANIJA || "").trim() || null,
    datum_upisa: parseDate(o.DATUM_UPISA),
    web_stranica: (o.WEB_STRANICA || "").trim() || null,
    datum_statusa: parseDate(o.DATUM_STATUSA),
    skraceni_naziv: (o.SKRACENI_NAZIV || "").trim() || null,
    ciljane_skupine: groups || null,
    opis_djelatnosti: (o.OPIS_DJELATNOSTI || "").trim() || null,
    registarski_broj: (o.REGISTARSKI_BROJ || "").trim() || null,
    oblik_udruzivanja: (o.OBLIK_UDRUZIVANJA || "").trim() || null,
    gospodarske_djelatnosti: (o.GOSPODARSKE_DJELATNOSTI || "").trim() || null,
    naziv_na_drugim_jezicima: (o.NAZIV_NA_DRUGIM_JEZICIMA || "").trim() || null,
    datum_osnivacke_skupstine: parseDate(o.DATUM_OSNIVACKE_SKUPSTINE),
    skr_naziv_na_drugim_jezicima: (o.SKR_NAZIV_NA_DRUGIM_JEZICIMA || "").trim() || null,

    street,
    city,

    mapped_category: score.category,
    mapped_confidence: score.confidence,
    mapped_rule: score.rule,

    import_batch_id: BATCH_BATCH_ID,
  };
}

async function flushBatch(rows) {
  if (rows.length === 0) return 0;
  if (DRY_RUN) return rows.length;

  // Upsert on oib. We deliberately DON'T overwrite lat/lng/geocode_*; the
  // geocoder updates those separately. Send only fields we know about.
  const { error } = await supabaseAdmin
    .from("ngo_registry")
    .upsert(rows, { onConflict: "oib", ignoreDuplicates: false });
  if (error) {
    console.error("Upsert error:", error.message);
    console.error("First offending OIB:", rows[0]?.oib);
    throw error;
  }
  return rows.length;
}

const stream = fs.createReadStream(CSV_PATH);
const rowsAsync = parseCsvStream(stream);

let header = null;
let totalRead = 0;
let totalKept = 0;
let totalUpserted = 0;
let totalSkippedNoOib = 0;
let totalSkippedDup = 0;
const seenOibs = new Set();
const stats = {
  byStatus: {},
  byMappedCategory: {},
  byZupanija: {},
  withMail: 0,
  withWeb: 0,
};

let batch = [];
const BATCH_SIZE = 500;

const t0 = Date.now();

for await (const row of rowsAsync) {
  if (!header) {
    header = row;
    continue;
  }
  const obj = {};
  for (let i = 0; i < header.length; i++) obj[header[i]] = row[i] ?? "";
  totalRead++;

  if (totalRead > LIMIT) break;

  if (ACTIVE_ONLY && obj.STATUS !== "AKTIVAN") continue;
  if (ONLY_ZG && !(obj.ZUPANIJA || "").includes("Grad Zagreb")) continue;

  const r = rowToRegistry(obj);
  if (!r.oib || r.oib.length !== 11) {
    totalSkippedNoOib++;
    continue;
  }
  if (seenOibs.has(r.oib)) {
    totalSkippedDup++;
    continue;
  }
  seenOibs.add(r.oib);

  // Stats
  stats.byStatus[r.status] = (stats.byStatus[r.status] || 0) + 1;
  if (r.mapped_category) stats.byMappedCategory[r.mapped_category] = (stats.byMappedCategory[r.mapped_category] || 0) + 1;
  else stats.byMappedCategory["__unmapped"] = (stats.byMappedCategory["__unmapped"] || 0) + 1;
  if (r.zupanija) stats.byZupanija[r.zupanija] = (stats.byZupanija[r.zupanija] || 0) + 1;
  if (r.mail) stats.withMail++;
  if (r.web_stranica) stats.withWeb++;

  batch.push(r);
  totalKept++;

  if (batch.length >= BATCH_SIZE) {
    const n = await flushBatch(batch);
    totalUpserted += n;
    batch = [];
    if (totalUpserted % 5000 === 0) {
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ... ${totalUpserted.toLocaleString()} upserted (${dt}s elapsed)`);
    }
  }
}

const n = await flushBatch(batch);
totalUpserted += n;

if (!DRY_RUN) {
  await setCursor("import-registry", BATCH_BATCH_ID, totalUpserted, JSON.stringify({
    csv: CSV_PATH,
    activeOnly: ACTIVE_ONLY,
    onlyZg: ONLY_ZG,
    finishedAt: new Date().toISOString(),
  }));
}

const dt = ((Date.now() - t0) / 1000).toFixed(1);

console.log("\n=== Import report ===");
console.log(`CSV rows read   : ${totalRead.toLocaleString()}`);
console.log(`Rows kept       : ${totalKept.toLocaleString()} (after status/region filters)`);
console.log(`Rows upserted   : ${totalUpserted.toLocaleString()}`);
console.log(`Skipped no OIB  : ${totalSkippedNoOib}`);
console.log(`Skipped duplicate OIB in CSV: ${totalSkippedDup}`);
console.log(`With email      : ${stats.withMail.toLocaleString()}`);
console.log(`With website    : ${stats.withWeb.toLocaleString()}`);
console.log(`Elapsed         : ${dt}s`);
console.log("\nBy mapped_category:");
for (const [k, v] of Object.entries(stats.byMappedCategory).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(6)}  ${k}`);
}
console.log("\nTop zupanije (kept):");
for (const [k, v] of Object.entries(stats.byZupanija).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(v).padStart(6)}  ${k}`);
}

if (DRY_RUN) console.log("\n[DRY RUN] no rows written.");
