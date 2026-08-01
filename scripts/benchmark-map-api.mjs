#!/usr/bin/env node

/**
 * Read-only benchmark for the versioned, bounded location endpoint.
 *
 * Usage:
 *   node scripts/benchmark-map-api.mjs --base http://127.0.0.1:3000 --iterations 5
 *
 * It prints machine-readable JSON and exits non-zero if the response contract
 * exceeds the hard feature/payload budgets. Timing budgets are reported but
 * not enforced here because local and CI network conditions differ.
 */

import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);

function valueAfter(flag, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.ceil((percentileValue / 100) * ordered.length) - 1
  );
  return ordered[Math.max(0, index)];
}

const base = valueAfter("--base", "http://127.0.0.1:3000").replace(/\/$/, "");
const iterations = Math.max(
  1,
  Math.min(20, Number.parseInt(valueAfter("--iterations", "5"), 10) || 5)
);
const query = new URLSearchParams({
  bbox: valueAfter("--bbox", "13,42,20,47"),
  zoom: valueAfter("--zoom", "7"),
  limit: "150",
});
const search = valueAfter("--query", "");
if (search) query.set("q", search);
const endpoint = `${base}/api/v1/map/institutions?${query}`;

const samples = [];
let budgetFailure = false;
let firstEtag = null;

for (let index = 0; index < iterations; index += 1) {
  const started = performance.now();
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json", "Accept-Encoding": "gzip, br" },
  });
  const headersAt = performance.now();
  const bytes = new Uint8Array(await response.arrayBuffer());
  const ended = performance.now();
  let payload = null;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // The status and payload-size checks below still produce useful output.
  }

  const featureCount = Array.isArray(payload?.features)
    ? payload.features.length
    : null;
  const sample = {
    iteration: index + 1,
    status: response.status,
    ttfbMs: Number((headersAt - started).toFixed(1)),
    totalMs: Number((ended - started).toFixed(1)),
    decodedBytes: bytes.byteLength,
    contentLength: Number(response.headers.get("content-length")) || null,
    cacheControl: response.headers.get("cache-control"),
    etag: response.headers.get("etag"),
    strategy: response.headers.get("x-map-query-strategy"),
    featureCount,
    totalMatches: payload?.meta?.totalMatches ?? null,
    totalFeatures: payload?.meta?.totalFeatures ?? null,
    truncated: payload?.meta?.truncated ?? null,
    mode: payload?.meta?.mode ?? null,
  };
  samples.push(sample);
  firstEtag ??= sample.etag;
  const cacheContractValid = /(?:^|,)\s*s-maxage=\d+/i.test(sample.cacheControl ?? "");
  const etagStable = Boolean(sample.etag) && sample.etag === firstEtag;
  if (
    !response.ok ||
    bytes.byteLength > 150 * 1024 ||
    (featureCount ?? 151) > 150 ||
    !cacheContractValid ||
    !etagStable
  ) {
    budgetFailure = true;
  }
}

const coldSamples = samples.slice(0, 1);
const warmSamples = samples.slice(1);

const summary = {
  endpoint,
  measuredAt: new Date().toISOString(),
  iterations,
  budgets: {
    maximumDecodedBytes: 150 * 1024,
    maximumFeatures: 150,
    targetWarmP95Ms: 300,
    targetColdP95Ms: 800,
  },
  result: {
    coldTtfbMs: coldSamples[0]?.ttfbMs ?? null,
    coldTotalMs: coldSamples[0]?.totalMs ?? null,
    warmP50TtfbMs: percentile(warmSamples.map((sample) => sample.ttfbMs), 50),
    warmP95TtfbMs: percentile(warmSamples.map((sample) => sample.ttfbMs), 95),
    warmP50TotalMs: percentile(warmSamples.map((sample) => sample.totalMs), 50),
    warmP95TotalMs: percentile(warmSamples.map((sample) => sample.totalMs), 95),
    maximumDecodedBytes: Math.max(...samples.map((sample) => sample.decodedBytes)),
    maximumFeatures: Math.max(...samples.map((sample) => sample.featureCount ?? 0)),
    stableEtag: Boolean(firstEtag) && samples.every((sample) => sample.etag === firstEtag),
    cacheContractValid: samples.every((sample) =>
      /(?:^|,)\s*s-maxage=\d+/i.test(sample.cacheControl ?? "")
    ),
    hardBudgetsPassed: !budgetFailure,
  },
  samples,
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (budgetFailure) process.exitCode = 1;
