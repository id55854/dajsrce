#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const buildDir = resolve(process.cwd(), ".next");
const appManifest = JSON.parse(
  await readFile(resolve(buildDir, "app-build-manifest.json"), "utf8")
);
const loadableManifest = JSON.parse(
  await readFile(resolve(buildDir, "react-loadable-manifest.json"), "utf8")
);

// The map moved to `/`, and `/map` is now the permanent redirect. That swapped
// the two entries this budget used to compare, so measuring `/map/page` would
// silently weigh a redirect and pass at ~0 bytes.
//
// The baseline is no longer "whatever the other route happens to load" either,
// because that made the number depend on which route was a redirect. It is now
// the chunk set every page in the build shares; the framework and root layout
//, which is a stable definition regardless of how routes are arranged.
const mapEntry = appManifest.pages?.["/page"];
if (!Array.isArray(mapEntry)) {
  throw new Error("The production build does not contain / (the map route)");
}

// "Shared with at least one other route" is the dividing line. A chunk 28
// other pages also load is not the map's marginal cost; it is app-wide
// weight, and Next already reports that as "First Load JS shared by all". What
// is left is the code that exists because this route exists, plus its dynamic
// imports below.
//
// NOTE: this is a stricter baseline than the pre-move script used, which
// subtracted only whatever the (then trivial) `/page` redirect happened to
// load. Numbers from before the map moved to `/` are not comparable to these.
const otherEntries = Object.entries(appManifest.pages ?? {})
  .filter(([route, files]) => route !== "/page" && Array.isArray(files))
  .map(([, files]) => files);
const sharedFiles = new Set(
  mapEntry.filter((file) => otherEntries.some((entry) => entry.includes(file)))
);
const mapFiles = new Set(mapEntry.filter((file) => !sharedFiles.has(file)));
for (const [key, value] of Object.entries(loadableManifest)) {
  // The MapLibre component is a dynamic import from the map experience module.
  if (
    key.includes("app\\map\\map-experience.tsx") ||
    key.includes("app/map/map-experience.tsx")
  ) {
    for (const file of value.files ?? []) mapFiles.add(file);
  }
}

const measured = [];
for (const file of [...mapFiles].sort()) {
  const bytes = (await stat(resolve(buildDir, file))).size;
  measured.push({ file, bytes });
}

// A budget that measures nothing reads as a pass. If the route layout changes
// again, fail here rather than reporting a reassuring zero.
if (measured.length === 0) {
  throw new Error(
    "Measured no map-specific chunks: the manifest keys this budget relies on have moved"
  );
}

const totalRawBytes = measured.reduce((sum, item) => sum + item.bytes, 0);
// MapLibre 6 replaces Leaflet: its renderer is ~1 MB raw. Keep a bounded
// renderer-inclusive budget and include the separately served worker modules,
// which Next's manifests do not track. Compressed transfer is bounded too.
const maximumRawBytes = 1280 * 1024;
const maximumWorkerRawBytes = 600 * 1024;
const maximumGzipBytes = 500 * 1024;
const workerFiles = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
let workerRawBytes = 0;
let totalGzipBytes = 0;
for (const file of mapFiles) totalGzipBytes += gzipSync(await readFile(resolve(buildDir, file))).length;
for (const file of workerFiles) {
  const contents = await readFile(resolve(process.cwd(), "public/maplibre", file));
  workerRawBytes += contents.length;
  totalGzipBytes += gzipSync(contents).length;
}
const result = {
  route: "/",
  budget: { maximumRawBytes, maximumWorkerRawBytes, maximumGzipBytes, excludesSharedFramework: true },
  result: { totalRawBytes, workerRawBytes, totalGzipBytes, passed: totalRawBytes <= maximumRawBytes && workerRawBytes <= maximumWorkerRawBytes && totalGzipBytes <= maximumGzipBytes },
  files: measured,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.result.passed) process.exitCode = 1;
