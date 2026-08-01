// Resumable staged import for RegistarUdruga.csv.
//
// Each source row is preserved with its raw payload and validation result.
// Valid rows are merged set-wise in Postgres. The batch checkpoint is advanced
// after every committed batch, so interruption never requires starting over.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseCsvStream } from "./lib/csv-stream.mjs";
import {
  scoreRow,
  parseSjediste,
  inferAcceptsDonations,
} from "./lib/category-rules.mjs";
import { isValidOib } from "./lib/oib.mjs";
import { supabaseAdmin, setCursor } from "./lib/supabase-admin.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argVal = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};

function resolveCsvPath() {
  const candidates = [
    argVal("--csv"),
    process.env.REGISTRY_CSV_PATH,
    path.resolve(process.cwd(), "RegistarUdruga.csv"),
    path.resolve(process.cwd(), "../RegistarUdruga.csv"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

const CSV_PATH = resolveCsvPath();
const ONLY_ZG = flag("--zg");
const ACTIVE_ONLY = !flag("--include-inactive");
const DRY_RUN = flag("--dry-run");
const LIMIT = argVal("--limit") ? Number.parseInt(argVal("--limit"), 10) : Number.POSITIVE_INFINITY;
const BATCH_SIZE = Math.min(1_000, Math.max(50, Number.parseInt(argVal("--batch-size", "500"), 10)));

if (!CSV_PATH || !fs.existsSync(CSV_PATH)) {
  console.error("Registry CSV not found. Set --csv <path> or REGISTRY_CSV_PATH.");
  process.exit(1);
}
if (!Number.isFinite(LIMIT) && LIMIT !== Number.POSITIVE_INFINITY) {
  console.error("--limit must be a positive integer");
  process.exit(1);
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function parseDate(value) {
  if (!value) return null;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, monthRaw, dayRaw, yearRaw] = match;
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const year = Number(yearRaw);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return `${yearRaw}-${monthRaw.padStart(2, "0")}-${dayRaw.padStart(2, "0")}`;
}

function normalizeRegistryRow(raw) {
  const sjediste = (raw.SJEDISTE || "").trim();
  const { street, city } = parseSjediste(sjediste);
  const groups = (raw.CILJANE_SKUPINE || "").trim();
  const activityText = `${raw.OPIS_DJELATNOSTI || ""}\n${raw.CILJEVI || ""}`.trim();
  const name = (raw.NAZIV || "").trim();
  const score = scoreRow({ groups, text: activityText, name });

  return {
    oib: (raw.OIB || "").trim(),
    mail: (raw.MAIL || "").trim() || null,
    naziv: name,
    status: (raw.STATUS || "").trim(),
    udr_id: (raw.UDR_ID || "").trim() || null,
    ciljevi: (raw.CILJEVI || "").trim() || null,
    sjediste: sjediste || null,
    zupanija: (raw.ZUPANIJA || "").trim() || null,
    datum_upisa: parseDate(raw.DATUM_UPISA),
    web_stranica: (raw.WEB_STRANICA || "").trim() || null,
    datum_statusa: parseDate(raw.DATUM_STATUSA),
    skraceni_naziv: (raw.SKRACENI_NAZIV || "").trim() || null,
    ciljane_skupine: groups || null,
    opis_djelatnosti: (raw.OPIS_DJELATNOSTI || "").trim() || null,
    registarski_broj: (raw.REGISTARSKI_BROJ || "").trim() || null,
    oblik_udruzivanja: (raw.OBLIK_UDRUZIVANJA || "").trim() || null,
    gospodarske_djelatnosti: (raw.GOSPODARSKE_DJELATNOSTI || "").trim() || null,
    naziv_na_drugim_jezicima: (raw.NAZIV_NA_DRUGIM_JEZICIMA || "").trim() || null,
    datum_osnivacke_skupstine: parseDate(raw.DATUM_OSNIVACKE_SKUPSTINE),
    skr_naziv_na_drugim_jezicima: (raw.SKR_NAZIV_NA_DRUGIM_JEZICIMA || "").trim() || null,
    street,
    city,
    mapped_category: score.category,
    mapped_confidence: score.confidence,
    mapped_rule: score.rule,
    classification_status: score.classificationStatus,
    classification_reasons: score.reviewReasons,
    classification_candidates: score.candidateCategories,
    classification_version: score.classificationVersion,
    donation_candidates: inferAcceptsDonations(score.category, `${activityText}\n${groups}`),
  };
}

function validateRow(row, seenOibs) {
  const errors = [];
  if (!row.oib) errors.push("missing_oib");
  else if (!isValidOib(row.oib)) errors.push("invalid_oib_checksum");
  if (!row.naziv) errors.push("missing_name");
  if (!row.status) errors.push("missing_status");
  if (row.oib && seenOibs.has(row.oib)) errors.push("duplicate_oib_in_source");
  if (row.oib && !errors.includes("duplicate_oib_in_source")) seenOibs.add(row.oib);
  return errors;
}

const sourceHash = await sha256File(CSV_PATH);
const batchVariant = `${sourceHash}|active=${ACTIVE_ONLY}|zg=${ONLY_ZG}`;
const batchId = `registry-${crypto.createHash("sha256").update(batchVariant).digest("hex").slice(0, 20)}`;
const cursorName = `import-registry:${batchId}`;

let resumeAfter = 0;
if (!DRY_RUN) {
  const { data: existingBatch, error: batchReadError } = await supabaseAdmin
    .from("registry_import_batches")
    .select("last_source_row, status")
    .eq("id", batchId)
    .maybeSingle();
  if (batchReadError) throw batchReadError;
  resumeAfter = Number(existingBatch?.last_source_row ?? 0);
  const { error: batchError } = await supabaseAdmin.from("registry_import_batches").upsert({
    id: batchId,
    source_file_hash: sourceHash,
    source_path: path.basename(CSV_PATH),
    status: "running",
    completed_at: null,
    error: null,
  });
  if (batchError) throw batchError;
}

console.log(`Source: ${CSV_PATH}`);
console.log(`SHA-256: ${sourceHash}`);
console.log(`Batch: ${batchId} | resume after source row: ${resumeAfter} | dry-run: ${DRY_RUN}`);

let header = null;
let sourceRowNumber = 0;
let examinedThisRun = 0;
let staged = 0;
let merged = 0;
let invalid = 0;
let filtered = 0;
let batch = [];
const seenOibs = new Set();
const startedAt = Date.now();

async function flushBatch() {
  if (batch.length === 0) return;
  const rows = batch;
  batch = [];
  const firstRow = rows[0].source_row_number;
  const lastRow = rows.at(-1).source_row_number;
  if (DRY_RUN) {
    staged += rows.length;
    invalid += rows.filter((row) => row.validation_status === "invalid").length;
    merged += rows.filter((row) => row.validation_status === "valid").length;
    return;
  }

  const { error: stageError } = await supabaseAdmin
    .from("ngo_registry_staging")
    .upsert(rows, { onConflict: "batch_id,source_row_number" });
  if (stageError) throw stageError;

  const { data: result, error: mergeError } = await supabaseAdmin.rpc(
    "merge_registry_import_batch",
    { p_batch_id: batchId, p_from_row: firstRow, p_to_row: lastRow }
  );
  if (mergeError) throw mergeError;
  staged += Number(result?.staged ?? rows.length);
  merged += Number(result?.merged ?? 0);
  invalid += Number(result?.invalid ?? 0);
  await setCursor(cursorName, String(lastRow), merged, JSON.stringify({
    sourceHash,
    batchId,
    lastSourceRow: lastRow,
    updatedAt: new Date().toISOString(),
  }));
  console.log(`  committed through source row ${lastRow.toLocaleString()} (merged ${merged.toLocaleString()}, invalid ${invalid.toLocaleString()})`);
}

try {
  for await (const csvRow of parseCsvStream(fs.createReadStream(CSV_PATH))) {
    if (!header) {
      header = csvRow.map((value) => value.replace(/^\uFEFF/, ""));
      continue;
    }
    sourceRowNumber += 1;
    if (sourceRowNumber <= resumeAfter) continue;
    if (examinedThisRun >= LIMIT) break;
    examinedThisRun += 1;

    const raw = Object.fromEntries(header.map((name, index) => [name, csvRow[index] ?? ""]));
    if (ACTIVE_ONLY && raw.STATUS !== "AKTIVAN") {
      filtered += 1;
      continue;
    }
    if (ONLY_ZG && !(raw.ZUPANIJA || "").includes("Grad Zagreb")) {
      filtered += 1;
      continue;
    }

    const normalized = normalizeRegistryRow(raw);
    const validationErrors = validateRow(normalized, seenOibs);
    batch.push({
      batch_id: batchId,
      source_row_number: sourceRowNumber,
      oib: normalized.oib || null,
      raw_row_jsonb: raw,
      normalized_jsonb: normalized,
      validation_status: validationErrors.length ? "invalid" : "valid",
      validation_errors: validationErrors,
    });
    if (batch.length >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  if (!DRY_RUN) {
    const { error } = await supabaseAdmin
      .from("registry_import_batches")
      .update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", batchId);
    if (error) throw error;
  }
} catch (error) {
  if (!DRY_RUN) {
    await supabaseAdmin
      .from("registry_import_batches")
      .update({
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 2000) : "Unknown import failure",
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId);
  }
  throw error;
}

console.log("\n=== Registry import report ===");
console.log(`Source rows examined : ${examinedThisRun.toLocaleString()}`);
console.log(`Filtered             : ${filtered.toLocaleString()}`);
console.log(`Staged               : ${staged.toLocaleString()}`);
console.log(`${DRY_RUN ? "Would merge" : "Merged"}          : ${merged.toLocaleString()}`);
console.log(`Invalid/quarantined  : ${invalid.toLocaleString()}`);
console.log(`Elapsed              : ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
if (DRY_RUN) console.log("[DRY RUN] No database rows were written.");
