// Import audited DGU INSPIRE address matches into the active public registry.
// The input is JSONL produced by audit-dgu-address-match.mjs. Rows are staged
// through PostgREST and applied by bounded transactional RPC calls.
//
// Usage:
//   node scripts/import-dgu-geocodes.mjs --input matches.jsonl \
//     --dataset-updated 2026-08-02T00:00:00Z --archive-sha256 <sha256>

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import process from "node:process";
import { supabaseAdmin } from "./lib/supabase-admin.mjs";

const args = process.argv.slice(2);
function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const inputPath = argValue("--input");
const datasetUpdatedInput = argValue("--dataset-updated");
const archiveSha256 = argValue("--archive-sha256")?.toLowerCase();
const requestedBatchId = argValue("--batch-id");
const resume = args.includes("--resume");
const batchSize = Math.min(500, Math.max(50, Number.parseInt(argValue("--batch-size") ?? "500", 10)));
const applySize = Math.min(500, Math.max(25, Number.parseInt(argValue("--apply-size") ?? "100", 10)));

if (!inputPath || !fs.existsSync(inputPath)) throw new Error("--input must point to a match JSONL file");
if (!datasetUpdatedInput || !Number.isFinite(Date.parse(datasetUpdatedInput))) {
  throw new Error("--dataset-updated must be a valid timestamp");
}
if (!archiveSha256 || !/^[0-9a-f]{64}$/.test(archiveSha256)) {
  throw new Error("--archive-sha256 must be a lowercase SHA-256 digest");
}
if (!Number.isInteger(batchSize)) throw new Error("--batch-size must be an integer");
if (!Number.isInteger(applySize)) throw new Error("--apply-size must be an integer");

const DATASET_URL = "https://geoportal.dgu.hr/services/atom/ad/xml";
const datasetUpdatedAt = new Date(datasetUpdatedInput).toISOString();
const batchId = requestedBatchId ?? `dgu-addresses-${archiveSha256.slice(0, 20)}`;

const { data: existingBatch, error: existingBatchError } = await supabaseAdmin
  .from("registry_geocode_batches")
  .select("status,expected_rows,applied_rows,source_archive_sha256")
  .eq("id", batchId)
  .maybeSingle();
if (existingBatchError) throw existingBatchError;
if (existingBatch?.status === "completed") {
  if (existingBatch.source_archive_sha256 !== archiveSha256) {
    throw new Error(`completed batch ${batchId} has a different source hash`);
  }
  console.log(JSON.stringify({
    batch_id: batchId,
    status: "already_completed",
    exact_building_points: existingBatch.applied_rows,
  }, null, 2));
  process.exit(0);
}

const { error: batchError } = await supabaseAdmin
  .from("registry_geocode_batches")
  .upsert({
    id: batchId,
    provider: "dgu_inspire_addresses",
    dataset_url: DATASET_URL,
    dataset_updated_at: datasetUpdatedAt,
    source_archive_sha256: archiveSha256,
    status: "running",
    error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
if (batchError) throw batchError;

let lineNumber = 0;
let staged = 0;
let rows = [];
const seenUdrIds = new Set();

async function flush() {
  if (rows.length === 0) return;
  const pending = rows;
  rows = [];
  const { error } = await supabaseAdmin
    .from("registry_dgu_geocode_staging")
    .upsert(pending, { onConflict: "batch_id,udr_id" });
  if (error) throw error;
  staged += pending.length;
  console.log(`  staged ${staged.toLocaleString()} exact building points`);
}

try {
  if (resume) {
    staged = Number(existingBatch?.expected_rows ?? 0);
    if (!existingBatch || existingBatch.source_archive_sha256 !== archiveSha256 || staged < 1) {
      throw new Error("--resume requires an existing incomplete batch with the same archive hash");
    }
    console.log(`  resuming ${staged.toLocaleString()} staged building points`);
  } else {
    const input = readline.createInterface({
      input: fs.createReadStream(path.resolve(inputPath), { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of input) {
      lineNumber += 1;
      if (!line.trim()) continue;
      let match;
      try {
        match = JSON.parse(line);
      } catch {
        throw new Error(`invalid JSON on input line ${lineNumber}`);
      }

      const udrId = String(match.udr_id ?? "").trim();
      if (!udrId || seenUdrIds.has(udrId)) {
        throw new Error(`missing or duplicate udr_id on input line ${lineNumber}`);
      }
      seenUdrIds.add(udrId);
      if (match.source !== "dgu_inspire_addresses" || match.confidence !== "building") {
        throw new Error(`untrusted source/confidence on input line ${lineNumber}`);
      }
      if (!Number.isFinite(match.latitude) || match.latitude < 42 || match.latitude > 47 ||
          !Number.isFinite(match.longitude) || match.longitude < 13 || match.longitude > 20) {
        throw new Error(`coordinate outside Croatia on input line ${lineNumber}`);
      }
      if (!String(match.dgu_address_id ?? "").startsWith("KB.")) {
        throw new Error(`invalid DGU address identifier on input line ${lineNumber}`);
      }

      rows.push({
        batch_id: batchId,
        udr_id: udrId,
        latitude: match.latitude,
        longitude: match.longitude,
        dgu_address_id: match.dgu_address_id,
        matched_address: match.matched_address,
        match_method: match.match_method,
      });
      if (rows.length >= batchSize) await flush();
    }
    await flush();
    if (staged === 0) throw new Error("match file contained no rows");

    const { error: countError } = await supabaseAdmin
      .from("registry_geocode_batches")
      .update({ expected_rows: staged, staged_rows: staged, updated_at: new Date().toISOString() })
      .eq("id", batchId);
    if (countError) throw countError;
  }

  let totalApplied = Number(existingBatch?.applied_rows ?? 0);
  let currentApplySize = applySize;
  let transientRetries = 0;
  for (;;) {
    const { data, error } = await supabaseAdmin.rpc("apply_registry_dgu_geocode_batch", {
      p_batch_id: batchId,
      p_limit: currentApplySize,
    });
    if (error?.code === "57014" && currentApplySize > 25) {
      currentApplySize = Math.max(25, Math.floor(currentApplySize / 2));
      console.warn(`  database timeout; retrying with ${currentApplySize}-row transactions`);
      transientRetries = 0;
      continue;
    }
    const transientMessage = `${error?.message ?? ""} ${error?.details ?? ""}`;
    const isTransient = error?.code === "57014" ||
      /fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|socket/i.test(transientMessage);
    if (error && isTransient && transientRetries < 8) {
      transientRetries += 1;
      const retryDelayMs = Math.min(10_000, transientRetries * 1_000);
      console.warn(
        `  transient database/network failure; retry ${transientRetries}/8 in ${retryDelayMs / 1_000}s`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    if (error) throw error;
    transientRetries = 0;
    const applied = Number(data?.applied ?? 0);
    const remaining = Number(data?.remaining ?? 0);
    totalApplied += applied;
    console.log(`  applied ${totalApplied.toLocaleString()} (${remaining.toLocaleString()} remaining)`);
    if (remaining === 0) break;
    if (applied === 0) throw new Error("DGU batch made no progress while rows remain");
  }

  const { data: report, error: finalizeError } = await supabaseAdmin.rpc(
    "finalize_registry_dgu_geocode_batch",
    { p_batch_id: batchId, p_expected_rows: staged }
  );
  if (finalizeError) throw finalizeError;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await supabaseAdmin
    .from("registry_geocode_batches")
    .update({
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);
  throw error;
}
