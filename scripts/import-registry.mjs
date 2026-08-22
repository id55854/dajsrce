// Resumable staged import for the official Registar udruga CTS CSV.
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

// PostgREST rejects with a plain `{code, message, details, hint}` object, not an
// Error, so the old `error instanceof Error` test recorded five consecutive
// production failures as the literal string "Unknown import failure" and left
// nothing to diagnose them with. Keep the batch row useful whatever was thrown.
function describeImportFailure(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const parts = [error.code, error.message, error.details, error.hint]
      .filter((part) => typeof part === "string" && part.length > 0);
    if (parts.length > 0) return parts.join(" | ");
    try {
      return JSON.stringify(error);
    } catch {
      /* fall through to the generic description */
    }
  }
  return `Unknown import failure (${typeof error})`;
}

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
const ACTIVE_ONLY = flag("--active-only");
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
if (!DRY_RUN && (!ACTIVE_ONLY || ONLY_ZG || Number.isFinite(LIMIT))) {
  console.error("Production imports must consume every active official row. Use --active-only without --zg or --limit.");
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
    udr_id: String(raw.UDR_ID || "").trim() || null,
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

function validateRow(row, seenUdrIds, seenOibs) {
  const errors = [];
  const warnings = [];
  if (!row.udr_id) errors.push("missing_udr_id");
  else if (seenUdrIds.has(row.udr_id)) errors.push("duplicate_udr_id_in_source");
  else seenUdrIds.add(row.udr_id);
  if (!row.naziv) errors.push("missing_name");
  if (!row.status) errors.push("missing_status");
  if (!row.oib) warnings.push("missing_oib");
  else {
    if (!isValidOib(row.oib)) warnings.push("invalid_oib_checksum");
    if (seenOibs.has(row.oib)) warnings.push("duplicate_oib_in_source");
    seenOibs.add(row.oib);
  }
  if (!row.sjediste) warnings.push("missing_address");
  if (!row.zupanija) warnings.push("missing_county");
  return {
    status: errors.length > 0 ? "invalid" : warnings.length > 0 ? "warning" : "valid",
    issues: [...errors, ...warnings],
  };
}

const sourceHash = await sha256File(CSV_PATH);
const batchVariant = `${sourceHash}|active=${ACTIVE_ONLY}|zg=${ONLY_ZG}`;
const batchId = `registry-${crypto.createHash("sha256").update(batchVariant).digest("hex").slice(0, 20)}`;
const cursorName = `import-registry:${batchId}`;
const sourceMetadataModified = process.env.REGISTRY_SOURCE_METADATA_MODIFIED || null;
const sourceBytes = process.env.REGISTRY_SOURCE_BYTES
  ? Number.parseInt(process.env.REGISTRY_SOURCE_BYTES, 10)
  : fs.statSync(CSV_PATH).size;

let resumeAfter = 0;
let resumeWarnings = 0;
if (!DRY_RUN) {
  const { data: existingBatch, error: batchReadError } = await supabaseAdmin
    .from("registry_import_batches")
    .select("last_source_row, status, rows_warning")
    .eq("id", batchId)
    .maybeSingle();
  if (batchReadError) throw batchReadError;
  resumeAfter = Number(existingBatch?.last_source_row ?? 0);
  resumeWarnings = Number(existingBatch?.rows_warning ?? 0);
  const { error: batchError } = await supabaseAdmin.from("registry_import_batches").upsert({
    id: batchId,
    source_file_hash: sourceHash,
    source_path: path.basename(CSV_PATH),
    source_dataset_id: process.env.REGISTRY_SOURCE_DATASET_ID || null,
    source_resource_id: process.env.REGISTRY_SOURCE_RESOURCE_ID || null,
    source_url: process.env.REGISTRY_SOURCE_URL || null,
    source_metadata_modified: sourceMetadataModified,
    source_bytes: sourceBytes,
    mirror_scope: "active",
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
let selectedSourceRows = 0;
let examinedThisRun = 0;
let staged = 0;
let merged = 0;
let invalid = 0;
let warnings = resumeWarnings;
let filtered = 0;
let batch = [];
const seenUdrIds = new Set();
const seenOibs = new Set();
const startedAt = Date.now();

async function flushBatch() {
  if (batch.length === 0) return;
  const rows = batch;
  batch = [];
  const lastRow = rows.at(-1).source_row_number;
  if (DRY_RUN) {
    staged += rows.length;
    invalid += rows.filter((row) => row.validation_status === "invalid").length;
    warnings += rows.filter((row) => row.validation_status === "warning").length;
    merged += rows.filter((row) => row.validation_status !== "invalid").length;
    return;
  }

  const { error: stageError } = await supabaseAdmin
    .from("ngo_registry_staging")
    .upsert(rows, { onConflict: "batch_id,source_row_number" });
  if (stageError) throw stageError;

  const mergeRange = async (rangeRows) => {
    const rangeFirst = rangeRows[0].source_row_number;
    const rangeLast = rangeRows.at(-1).source_row_number;
    const { data, error } = await supabaseAdmin.rpc(
      "merge_registry_import_batch",
      { p_batch_id: batchId, p_from_row: rangeFirst, p_to_row: rangeLast }
    );
    if (!error) return data;
    if (error.code === "57014" && rangeRows.length > 1) {
      const midpoint = Math.ceil(rangeRows.length / 2);
      console.warn(
        `  merge timed out for rows ${rangeFirst.toLocaleString()}-${rangeLast.toLocaleString()}; ` +
        `retrying as ${midpoint} + ${rangeRows.length - midpoint}`
      );
      const left = await mergeRange(rangeRows.slice(0, midpoint));
      const right = await mergeRange(rangeRows.slice(midpoint));
      return {
        staged: Number(left?.staged ?? 0) + Number(right?.staged ?? 0),
        merged: Number(left?.merged ?? 0) + Number(right?.merged ?? 0),
        invalid: Number(left?.invalid ?? 0) + Number(right?.invalid ?? 0),
      };
    }
    throw error;
  };

  const result = await mergeRange(rows);
  staged += Number(result?.staged ?? rows.length);
  merged += Number(result?.merged ?? 0);
  invalid += Number(result?.invalid ?? 0);
  warnings += rows.filter((row) => row.validation_status === "warning").length;
  const [warningUpdate] = await Promise.all([
    supabaseAdmin
      .from("registry_import_batches")
      .update({ rows_warning: warnings })
      .eq("id", batchId),
    setCursor(cursorName, String(lastRow), merged, JSON.stringify({
      sourceHash,
      batchId,
      lastSourceRow: lastRow,
      warnings,
      updatedAt: new Date().toISOString(),
    })),
  ]);
  if (warningUpdate.error) throw warningUpdate.error;
  console.log(`  committed through source row ${lastRow.toLocaleString()} (merged ${merged.toLocaleString()}, invalid ${invalid.toLocaleString()})`);
}

async function refreshFacetsWithRetry() {
  const maximumAttempts = 5;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const { data, error } = await supabaseAdmin.rpc(
      "refresh_registry_snapshot_facets",
      { p_batch_id: batchId }
    );
    if (!error) return data;
    if (error.code !== "57014" || attempt === maximumAttempts) throw error;
    console.warn(
      `Facet refresh timed out (${attempt}/${maximumAttempts}); retrying with warmed database pages...`
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
  }
  throw new Error("Registry facet refresh exhausted its retry budget");
}

try {
  for await (const csvRow of parseCsvStream(fs.createReadStream(CSV_PATH))) {
    if (!header) {
      header = csvRow.map((value) => value.replace(/^\uFEFF/, ""));
      continue;
    }
    sourceRowNumber += 1;
    const raw = Object.fromEntries(header.map((name, index) => [name, csvRow[index] ?? ""]));
    const isSelected = (!ACTIVE_ONLY || (raw.STATUS || "").trim() === "AKTIVAN") &&
      (!ONLY_ZG || (raw.ZUPANIJA || "").includes("Grad Zagreb"));
    if (isSelected) selectedSourceRows += 1;

    // Count the complete selected source even when resuming. Finalization uses
    // this value to prove that every active row made it into the snapshot.
    if (sourceRowNumber <= resumeAfter) continue;
    if (examinedThisRun >= LIMIT) break;
    examinedThisRun += 1;

    if (!isSelected) {
      filtered += 1;
      continue;
    }

    const normalized = normalizeRegistryRow(raw);
    const validation = validateRow(normalized, seenUdrIds, seenOibs);
    batch.push({
      batch_id: batchId,
      source_row_number: sourceRowNumber,
      udr_id: normalized.udr_id,
      oib: normalized.oib || null,
      raw_row_jsonb: raw,
      normalized_jsonb: normalized,
      validation_status: validation.status,
      validation_errors: validation.issues,
    });
    if (batch.length >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  if (!DRY_RUN) {
    const { error: warningError } = await supabaseAdmin
      .from("registry_import_batches")
      .update({ rows_warning: warnings })
      .eq("id", batchId);
    if (warningError) throw warningError;
    const facetReport = await refreshFacetsWithRetry();
    console.log(`Prepared directory facets: ${JSON.stringify(facetReport)}`);
    const { data: finalReport, error } = await supabaseAdmin.rpc(
      "finalize_registry_import_batch",
      { p_batch_id: batchId, p_expected_source_rows: selectedSourceRows }
    );
    if (error) throw error;
    console.log(`Finalized mirror: ${JSON.stringify(finalReport)}`);

    // The active snapshot is now authoritative. Purge obsolete canonical rows
    // first, while import_batch_id gives us a constant-time indexed candidate
    // path. This also makes legacy visibility reconciliation a tiny operation.
    try {
      let purge = { deleted: 0, complete: false };
      do {
        const { data, error: purgeError } = await supabaseAdmin.rpc(
          "purge_unpublished_registry_rows_batch",
          { p_limit: 500 }
        );
        if (purgeError) throw purgeError;
        purge = data;
        if (purge.deleted > 0) {
          console.log(`  purged ${purge.deleted} canonical rows outside the active snapshot`);
        }
      } while (!purge.complete);
    } catch (purgeError) {
      console.error(
        "Active snapshot was published, but inactive canonical-row purge failed:",
        purgeError instanceof Error ? purgeError.message : purgeError
      );
      process.exitCode = 1;
    }

    try {
      let cleanup = { directory_deleted: 0, memberships_deleted: 0, complete: false };
      do {
        const { data, error: cleanupError } = await supabaseAdmin.rpc(
          "cleanup_registry_snapshot_storage_batch",
          { p_limit: 500 }
        );
        if (cleanupError) throw cleanupError;
        cleanup = data;
        if (!cleanup.complete) {
          console.log(
            `  removed old snapshot rows (directory ${cleanup.directory_deleted}, ` +
            `membership ${cleanup.memberships_deleted})`
          );
        }
      } while (!cleanup.complete);
    } catch (cleanupError) {
      console.warn(
        "Published snapshot is healthy, but old snapshot storage cleanup must be retried:",
        cleanupError instanceof Error ? cleanupError.message : cleanupError
      );
    }

    // Public visibility is already atomically switched by finalization. Keep the
    // legacy flag used by maintenance scripts aligned in bounded best-effort
    // batches; a failure here must not mark a published snapshot as failed.
    try {
      let reconciled = { enabled: 0, disabled: 0, complete: false };
      do {
        const { data, error: reconcileError } = await supabaseAdmin.rpc(
          "reconcile_registry_source_presence_batch",
          { p_batch_id: batchId, p_limit: 500 }
        );
        if (reconcileError) throw reconcileError;
        reconciled = data;
        if (!reconciled.complete) {
          console.log(
            `  reconciled legacy visibility (+${reconciled.enabled}, -${reconciled.disabled})`
          );
        }
      } while (!reconciled.complete);
    } catch (reconcileError) {
      console.warn(
        "Published snapshot is healthy, but legacy source_present reconciliation must be retried:",
        reconcileError instanceof Error ? reconcileError.message : reconcileError
      );
    }
  }
} catch (error) {
  if (!DRY_RUN) {
    await supabaseAdmin
      .from("registry_import_batches")
      .update({
        status: "failed",
        error: describeImportFailure(error).slice(0, 2000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId);
  }
  throw error;
}

console.log("\n=== Registry import report ===");
console.log(`Source rows examined : ${examinedThisRun.toLocaleString()}`);
console.log(`Active source rows   : ${selectedSourceRows.toLocaleString()}`);
console.log(`Filtered             : ${filtered.toLocaleString()}`);
console.log(`Staged               : ${staged.toLocaleString()}`);
console.log(`${DRY_RUN ? "Would merge" : "Merged"}          : ${merged.toLocaleString()}`);
console.log(`Invalid/quarantined  : ${invalid.toLocaleString()}`);
console.log(`Warnings             : ${warnings.toLocaleString()}`);
console.log(`Elapsed              : ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
if (DRY_RUN) console.log("[DRY RUN] No database rows were written.");
