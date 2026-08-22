// Return dead registry storage to the filesystem.
//
// Deleting rows does not shrink a Postgres relation; it only marks space
// reusable. After a leaked snapshot is purged, the pages stay allocated and the
// database keeps counting them against the plan's storage ceiling - and, worse
// for the map, keeps them in the working set that has to fit in shared_buffers.
//
// The registry tables are rewritten wholesale twice a day, so they accumulate
// this faster than anything else here: registry_directory_entries carried
// 160 MB of indexes over 30 MB of live data, and a staging table with zero rows
// still held 10 MB of empty index pages.
//
// REINDEX CONCURRENTLY is used wherever possible: it builds the replacement
// alongside the original and swaps, so reads and writes keep working. VACUUM
// FULL does shrink the heap but takes an ACCESS EXCLUSIVE lock for its whole
// run, so it is opt-in behind --full and should be run in a quiet window.
//
//   node scripts/reclaim-registry-storage.mjs --dry-run
//   node scripts/reclaim-registry-storage.mjs
//   node scripts/reclaim-registry-storage.mjs --full
//
// Requires SUPABASE_ACCESS_TOKEN (a Supabase personal access token) plus
// NEXT_PUBLIC_SUPABASE_URL in .env.local. Statements run one per request, so
// none of them are wrapped in the implicit transaction that would reject
// REINDEX CONCURRENTLY and VACUUM.

import "./lib/supabase-admin.mjs"; // side effect: loads .env.local into process.env

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const DRY_RUN = flag("--dry-run");
const RUN_FULL = flag("--full");

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!accessToken) {
  console.error(
    "Missing SUPABASE_ACCESS_TOKEN in .env.local. Create a personal access token at\n" +
    "https://supabase.com/dashboard/account/tokens - the service role key cannot run REINDEX."
  );
  process.exit(1);
}
const projectRef = new URL(projectUrl).hostname.split(".")[0];
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function run(sql) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

const SIZE_QUERY = `
  SELECT
    pg_size_pretty(pg_database_size(current_database())) AS database_size,
    pg_database_size(current_database()) AS database_bytes
`;

// Every index on the tables the twice-daily sync rewrites, plus the two whose
// heaps carry the churn. Order is largest-benefit-first so an interrupted run
// still recovers most of the space.
const REINDEX_TARGETS = [
  "public.registry_directory_entries",
  "public.registry_snapshot_memberships",
  "public.ngo_registry",
  "public.registry_dgu_geocode_staging",
  "public.ngo_registry_staging",
  "public.institutions",
];

// VACUUM FULL rewrites the heap and every index, so it supersedes the REINDEX
// above for whatever it touches. Only the tables whose heap is meaningfully
// larger than their live data are worth the exclusive lock.
const VACUUM_FULL_TARGETS = [
  "public.ngo_registry",
  "public.registry_directory_entries",
  "public.ngo_registry_staging",
  "public.registry_dgu_geocode_staging",
];

function formatBytes(bytes) {
  return `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`;
}

const [before] = await run(SIZE_QUERY);
console.log(`Database size before: ${before.database_size}`);
if (DRY_RUN) {
  console.log("\n[DRY RUN] Would run, one statement per request:");
  for (const table of REINDEX_TARGETS) console.log(`  REINDEX TABLE CONCURRENTLY ${table};`);
  if (RUN_FULL) for (const table of VACUUM_FULL_TARGETS) console.log(`  VACUUM (FULL, ANALYZE) ${table};`);
  else console.log("  (pass --full to also VACUUM FULL the bloated heaps; takes an exclusive lock)");
  process.exit(0);
}

let failures = 0;

for (const table of REINDEX_TARGETS) {
  process.stdout.write(`REINDEX CONCURRENTLY ${table} ... `);
  try {
    await run(`REINDEX TABLE CONCURRENTLY ${table};`);
    console.log("done");
  } catch (error) {
    failures += 1;
    console.log(`FAILED: ${error.message}`);
    // A concurrent rebuild that dies leaves an invalid _ccnew index behind,
    // which keeps consuming the space this script exists to reclaim.
    console.log(`  check: SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`);
  }
}

if (RUN_FULL) {
  console.log("\nVACUUM FULL takes an exclusive lock per table; the map and register");
  console.log("will block on each one for its duration.");
  for (const table of VACUUM_FULL_TARGETS) {
    process.stdout.write(`VACUUM (FULL, ANALYZE) ${table} ... `);
    try {
      await run(`VACUUM (FULL, ANALYZE) ${table};`);
      console.log("done");
    } catch (error) {
      failures += 1;
      console.log(`FAILED: ${error.message}`);
    }
  }
} else {
  // Plain VACUUM ANALYZE cannot shrink the file, but it does refresh the
  // planner statistics the rewritten map query depends on.
  for (const table of VACUUM_FULL_TARGETS) {
    try {
      await run(`VACUUM (ANALYZE) ${table};`);
    } catch (error) {
      console.log(`VACUUM ANALYZE ${table} failed: ${error.message}`);
    }
  }
}

const [after] = await run(SIZE_QUERY);
const reclaimed = Number(before.database_bytes) - Number(after.database_bytes);
console.log(`\nDatabase size after:  ${after.database_size}`);
console.log(`Reclaimed:            ${formatBytes(reclaimed)}`);
if (!RUN_FULL) {
  console.log("\nHeap bloat still held. Run with --full in a quiet window to release it.");
}
if (failures > 0) {
  console.error(`\n${failures} statement(s) failed.`);
  process.exitCode = 1;
}
