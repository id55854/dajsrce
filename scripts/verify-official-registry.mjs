// Production-safe integrity, ordering, performance, and access-control checks
// for the published official association registry snapshot.

import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./lib/supabase-admin.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error("Missing public Supabase URL or anon key");

const publicClient = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const timings = {};

async function timed(name, operation) {
  const startedAt = performance.now();
  const result = await operation();
  timings[name] = Math.round(performance.now() - startedAt);
  return result;
}

const { data: facets, error: facetsError } = await timed("facets_ms", () =>
  publicClient.rpc("association_registry_facets_v1")
);
assert.ifError(facetsError);
assert.ok(facets.total > 0, "published registry must not be empty");
assert.equal(
  facets.statuses.reduce((sum, entry) => sum + Number(entry.count), 0),
  Number(facets.total),
  "status facets must cover every published organisation"
);
assert.match(facets.snapshot.source_file_hash, /^[a-f0-9]{64}$/);

const { data: firstPage, error: firstPageError } = await timed("first_page_ms", () =>
  publicClient.rpc("search_association_registry_v1", {
    p_page: 1,
    p_page_size: 100,
    p_sort: "name_asc",
  })
);
assert.ifError(firstPageError);
assert.equal(Number(firstPage.meta.total), Number(facets.total));
assert.equal(firstPage.items.length, Math.min(100, Number(facets.total)));

const collator = new Intl.Collator("hr", { numeric: true, sensitivity: "variant" });
for (let index = 1; index < firstPage.items.length; index += 1) {
  assert.ok(
    collator.compare(firstPage.items[index - 1].name, firstPage.items[index].name) <= 0,
    `Croatian name order failed at ${firstPage.items[index - 1].name}`
  );
}

for (const status of facets.statuses) {
  const { data, error } = await publicClient.rpc("search_association_registry_v1", {
    p_status: status.value,
    p_page: 1,
    p_page_size: 1,
    p_sort: "name_asc",
  });
  assert.ifError(error);
  assert.equal(Number(data.meta.total), Number(status.count), `status mismatch: ${status.value}`);
}

const lastPageNumber = Math.max(1, Math.ceil(Number(facets.total) / 100));
const { data: lastPage, error: lastPageError } = await timed("last_page_ms", () =>
  publicClient.rpc("search_association_registry_v1", {
    p_page: lastPageNumber,
    p_page_size: 100,
    p_sort: "name_asc",
  })
);
assert.ifError(lastPageError);
assert.ok(lastPage.items.length > 0 && lastPage.items.length <= 100);

const firstId = firstPage.items[0].id;
const { data: detail, error: detailError } = await timed("detail_ms", () =>
  publicClient.rpc("get_association_registry_entry_v1", { p_udr_id: firstId })
);
assert.ifError(detailError);
assert.equal(detail.id, firstId);

const { data: publication, error: publicationError } = await supabaseAdmin
  .from("registry_publication_state")
  .select("current_batch_id")
  .eq("singleton", true)
  .single();
assert.ifError(publicationError);

const [membershipResult, directoryResult, compatibilityResult] = await Promise.all([
  supabaseAdmin
    .from("registry_snapshot_memberships")
    .select("udr_id", { count: "exact", head: true })
    .eq("batch_id", publication.current_batch_id),
  supabaseAdmin
    .from("registry_directory_entries")
    .select("udr_id", { count: "exact", head: true })
    .eq("batch_id", publication.current_batch_id),
  supabaseAdmin
    .from("ngo_registry")
    .select("udr_id", { count: "exact", head: true })
    .eq("source_present", true),
]);
for (const result of [membershipResult, directoryResult, compatibilityResult]) {
  assert.ifError(result.error);
  assert.equal(Number(result.count), Number(facets.total));
}

const { error: directTableError } = await publicClient
  .from("ngo_registry")
  .select("udr_id")
  .limit(1);
assert.ok(directTableError, "anonymous direct canonical-table reads must be denied");

for (const [name, duration] of Object.entries(timings)) {
  assert.ok(duration < 10_000, `${name} exceeded the 10-second safety ceiling`);
}

console.log(JSON.stringify({
  ok: true,
  batch_id: publication.current_batch_id,
  total: Number(facets.total),
  statuses: facets.statuses,
  timings,
  direct_table_access: "denied",
}, null, 2));
