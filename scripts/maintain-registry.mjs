// Finish bounded post-publication maintenance without downloading the source.
// Safe to run repeatedly: every RPC is idempotent and targets the current
// atomically published registry snapshot.

import { supabaseAdmin } from "./lib/supabase-admin.mjs";

const args = process.argv.slice(2);
const argVal = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const requestedLimit = Number.parseInt(argVal("--batch-size", "500"), 10);
if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
  throw new Error("--batch-size must be a positive integer");
}

const { data: publication, error: publicationError } = await supabaseAdmin
  .from("registry_publication_state")
  .select("current_batch_id")
  .eq("singleton", true)
  .single();
if (publicationError) throw publicationError;
if (!publication.current_batch_id) throw new Error("Registry has no published snapshot");

async function drainRpc(name, createParams, describe) {
  let limit = Math.min(1_000, requestedLimit);
  let totals = {};
  while (true) {
    const { data, error } = await supabaseAdmin.rpc(name, createParams(limit));
    if (error?.code === "57014" && limit > 50) {
      limit = Math.max(50, Math.floor(limit / 2));
      console.warn(`${name} timed out; retrying with batch size ${limit}`);
      continue;
    }
    if (error) throw error;
    for (const [key, value] of Object.entries(data)) {
      if (key !== "complete" && typeof value === "number") {
        totals[key] = Number(totals[key] || 0) + value;
      }
    }
    if (data.complete) {
      console.log(`${describe}: ${JSON.stringify(totals)}`);
      return totals;
    }
  }
}

await drainRpc(
  "purge_unpublished_registry_rows_batch",
  (limit) => ({ p_limit: limit }),
  "Canonical rows purged"
);
await drainRpc(
  "cleanup_registry_snapshot_storage_batch",
  (limit) => ({ p_limit: limit }),
  "Historical projection rows removed"
);
await drainRpc(
  "reconcile_registry_source_presence_batch",
  (limit) => ({ p_batch_id: publication.current_batch_id, p_limit: limit }),
  "Legacy visibility reconciled"
);

console.log(`Registry maintenance complete for ${publication.current_batch_id}.`);
