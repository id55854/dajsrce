// Compare the active association registry with Croatia's authoritative DGU
// INSPIRE address points without loading the 2.6 GB GML document into memory.
//
// Usage:
//   node scripts/audit-dgu-address-match.mjs --archive C:\path\addresses.zip
//   node scripts/audit-dgu-address-match.mjs --archive ... --output matches.jsonl

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import proj4 from "proj4";
import { supabaseAdmin } from "./lib/supabase-admin.mjs";

const args = process.argv.slice(2);
function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const archivePath = argValue("--archive");
const outputPath = argValue("--output");
const unresolvedOutputPath = argValue("--unresolved-output");
if (!archivePath) throw new Error("--archive is required");
if (!fs.existsSync(archivePath)) throw new Error(`Archive not found: ${archivePath}`);

const DGU_DATASET_URL = "https://geoportal.dgu.hr/services/atom/ad/xml";
const EPSG_3035 = "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs +type=crs";
const EPSG_4326 = "+proj=longlat +datum=WGS84 +no_defs +type=crs";
const MEMBER_END = "</wfs:member>";

function xmlDecode(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeText(value, { withoutUlica = false } = {}) {
  let normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("hr")
    .replaceAll("đ", "d")
    .replace(/\bbr\.?\s*/g, "")
    .replace(/(\d)\s+([a-z])\b/g, "$1$2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutUlica) {
    normalized = normalized
      .replace(/\b(?:ulica|ul)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return normalized;
}

function stripUnitSuffix(street) {
  return String(street ?? "").replace(
    /\s+(\d+[a-zA-Z]?)(?:\s*\/\s*(?:\d+|[ivxlcdm]+))\s*$/i,
    " $1"
  );
}

function parseRegistryStreet(street) {
  const normalized = String(street ?? "").trim();
  const match = normalized.match(/^(.*?)\s+(\d+[a-zA-Z]?(?:\s*\/\s*(?:\d+|[ivxlcdm]+))?)\s*$/i);
  if (!match) return null;
  const house = normalizeText(match[2]).replaceAll(" ", "");
  const houses = new Set([house]);
  const base = house.match(/^(\d+[a-z]?)(?:\d+|iv|v|vi|vii|viii|ix|x)?$/i)?.[1];
  if (base && base !== house) houses.add(base);
  return {
    street: normalizeText(match[1], { withoutUlica: true }),
    houses: [...houses],
  };
}

function parseDguAddress(address, designator) {
  const postalMatch = address.match(/^(.*?)\s+(\d{5})\s+(.+)$/u);
  if (!postalMatch) return null;
  const buildingAddress = postalMatch[1].trim();
  const marker = ` ${designator} `;
  const markerIndex = buildingAddress.lastIndexOf(marker);
  if (markerIndex <= 0) return null;
  return {
    street: normalizeText(buildingAddress.slice(0, markerIndex), { withoutUlica: true }),
    house: normalizeText(designator).replaceAll(" ", ""),
    settlement: normalizeText(buildingAddress.slice(markerIndex + marker.length)),
    postalLocality: normalizeText(postalMatch[3]),
  };
}

function levenshteinSimilarity(left, right) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1);
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function streetSimilarity(left, right) {
  if (left === right) return 1;
  const leftTokens = left.split(" ").filter(Boolean);
  const rightTokens = right.split(" ").filter(Boolean);
  const leftLast = leftTokens.at(-1);
  const rightLast = rightTokens.at(-1);
  let score = levenshteinSimilarity(left, right);

  if (left.length >= 6 && right.length >= 6 && (left.includes(right) || right.includes(left))) {
    score = Math.max(score, 0.9);
  }

  // Registry data often abbreviates personal names ("J.J. Strossmayera").
  // Require the full surname plus compatible initials before treating such a
  // form as equivalent to DGU's unabbreviated official street name.
  if (leftLast && leftLast === rightLast) {
    const initials = (tokens) => tokens.slice(0, -1).map((token) => token[0]).join("");
    const leftInitials = initials(leftTokens);
    const rightInitials = initials(rightTokens);
    if (leftInitials && rightInitials &&
        (leftInitials === rightInitials || leftInitials.startsWith(rightInitials) || rightInitials.startsWith(leftInitials))) {
      score = Math.max(score, 0.94);
    }
  }
  return score;
}

function registryVariants(row) {
  const inputs = [
    { street: row.street, rank: 4, method: "official_exact" },
    { street: stripUnitSuffix(row.street), rank: 3, method: "unit_stripped" },
  ];
  const variants = new Map();
  for (const input of inputs) {
    const value = `${input.street ?? ""} ${row.city ?? ""}`;
    const exact = normalizeText(value);
    const withoutUlica = normalizeText(value, { withoutUlica: true });
    if (exact) {
      const candidate = { rank: input.rank, method: input.method };
      const current = variants.get(exact);
      if (!current || candidate.rank > current.rank) variants.set(exact, candidate);
    }
    if (withoutUlica && withoutUlica !== exact) {
      const candidate = { rank: input.rank - 2, method: `${input.method}_street_type` };
      const current = variants.get(withoutUlica);
      if (!current || candidate.rank > current.rank) variants.set(withoutUlica, candidate);
    }
  }
  return variants;
}

function dguVariants(address) {
  // DGU's alternativeIdentifier is: street + house number + settlement +
  // five-digit postal code + postal locality. The registry stores the prefix.
  const postalMatch = address.match(/^(.*?)\s+(\d{5})\s+(.+)$/u);
  const buildingAddress = postalMatch ? postalMatch[1].trim() : address.trim();
  const variants = [];
  for (const value of [buildingAddress]) {
    variants.push(normalizeText(value));
    variants.push(normalizeText(value, { withoutUlica: true }));
  }
  return [...new Set(variants.filter(Boolean))];
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const radius = 6_371_000;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function loadRegistryRows() {
  const rows = [];
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin
      .from("ngo_registry")
      .select("udr_id,sjediste,street,city,lat,lng,geocode_confidence")
      .eq("source_present", true)
      .eq("status", "AKTIVAN")
      .order("udr_id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function extractionProcess(archive) {
  if (process.platform === "win32") {
    return spawn("tar.exe", ["-xOf", archive, "Address.gml"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return spawn("unzip", ["-p", archive, "Address.gml"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const registryRows = await loadRegistryRows();
const targets = new Map();
const fuzzyTargets = new Map();
let unusableRegistryAddresses = 0;
for (const row of registryRows) {
  if (!row.street || !row.city || /\b(?:bb|b b)\b/i.test(row.street)) {
    unusableRegistryAddresses += 1;
    continue;
  }
  for (const [key, variant] of registryVariants(row)) {
    const entries = targets.get(key) ?? [];
    entries.push({ udrId: row.udr_id, ...variant });
    targets.set(key, entries);
  }
  const parsed = parseRegistryStreet(row.street);
  if (parsed && parsed.street) {
    const city = normalizeText(row.city);
    for (const house of parsed.houses) {
      const key = `${city}|${house}`;
      const entries = fuzzyTargets.get(key) ?? [];
      entries.push({ udrId: row.udr_id, street: parsed.street });
      fuzzyTargets.set(key, entries);
    }
  }
}

const candidates = new Map();
let dguAddressesScanned = 0;
let malformedDguAddresses = 0;
let parsedDguAddresses = 0;
let fuzzyBucketHits = 0;
let fuzzyScoreAccepted = 0;
let buffer = "";
const decoder = new TextDecoder("utf-8");
const extractor = extractionProcess(path.resolve(archivePath));
let extractorError = "";
extractor.stderr.setEncoding("utf8");
extractor.stderr.on("data", (chunk) => { extractorError += chunk; });

function processMember(member) {
  dguAddressesScanned += 1;
  const addressMatch = member.match(/<ad:alternativeIdentifier>(.*?)<\/ad:alternativeIdentifier>/s);
  const pointMatch = member.match(/<gml:pos>([-\d.]+)\s+([-\d.]+)<\/gml:pos>/s);
  const idMatch = member.match(/<base:localId>(KB\.[^<]+)<\/base:localId>/s);
  const designatorMatch = member.match(
    /<ad:LocatorDesignator><ad:designator>(.*?)<\/ad:designator>/s
  );
  if (!addressMatch || !pointMatch || !idMatch || !designatorMatch) {
    malformedDguAddresses += 1;
    return;
  }

  const dguAddress = xmlDecode(addressMatch[1]);
  // EPSG:3035's authoritative GML axis order is northing, easting. proj4 uses
  // the conventional easting, northing order, hence the deliberate swap.
  const northing = Number(pointMatch[1]);
  const easting = Number(pointMatch[2]);
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
    malformedDguAddresses += 1;
    return;
  }

  const designator = xmlDecode(designatorMatch[1]);
  for (const key of dguVariants(dguAddress)) {
    const registryTargets = targets.get(key);
    if (!registryTargets) continue;
    for (const target of registryTargets) {
      const existing = candidates.get(target.udrId) ?? [];
      const duplicate = existing.some((candidate) => candidate.dguId === idMatch[1]);
      if (!duplicate) {
        existing.push({
          dguId: idMatch[1],
          dguAddress,
          easting,
          northing,
          rank: target.rank,
          method: target.method,
        });
        candidates.set(target.udrId, existing);
      }
    }
  }

  const parsedDgu = parseDguAddress(dguAddress, designator);
  if (!parsedDgu) return;
  parsedDguAddresses += 1;
  const cityCandidates = new Map([
    [parsedDgu.settlement, 2],
    [parsedDgu.postalLocality, 1],
  ]);
  for (const [city, locationRank] of cityCandidates) {
    const registryTargets = fuzzyTargets.get(`${city}|${parsedDgu.house}`);
    if (!registryTargets) continue;
    fuzzyBucketHits += registryTargets.length;
    for (const target of registryTargets) {
      const score = streetSimilarity(target.street, parsedDgu.street);
      if (score < 0.82) continue;
      fuzzyScoreAccepted += 1;
      const existing = candidates.get(target.udrId) ?? [];
      const duplicate = existing.some((candidate) => candidate.dguId === idMatch[1]);
      if (!duplicate) {
        existing.push({
          dguId: idMatch[1],
          dguAddress,
          easting,
          northing,
          rank: locationRank,
          score,
          method: `${score === 1 ? "structured_exact" : "structured_fuzzy"}_${
            locationRank === 2 ? "settlement" : "postal"
          }`,
        });
        candidates.set(target.udrId, existing);
      }
    }
  }
}

extractor.stdout.on("data", (chunk) => {
  buffer += decoder.decode(chunk, { stream: true });
  let boundary;
  while ((boundary = buffer.indexOf(MEMBER_END)) >= 0) {
    const member = buffer.slice(0, boundary + MEMBER_END.length);
    buffer = buffer.slice(boundary + MEMBER_END.length);
    processMember(member);
  }
});

const exitCode = await new Promise((resolve, reject) => {
  extractor.on("error", reject);
  extractor.on("close", resolve);
});
buffer += decoder.decode();
if (exitCode !== 0) throw new Error(`Address extraction failed (${exitCode}): ${extractorError}`);

const matches = [];
const ambiguous = [];
const unresolved = [];
const existingDistances = [];
const methodCounts = new Map();
for (const row of registryRows) {
  const rowCandidates = candidates.get(row.udr_id) ?? [];
  const bestRank = Math.max(0, ...rowCandidates.map((candidate) => candidate.rank));
  const ranked = rowCandidates.filter((candidate) => candidate.rank === bestRank);
  const bestScore = Math.max(0, ...ranked.map((candidate) => candidate.score ?? 1));
  const best = ranked.filter((candidate) => (candidate.score ?? 1) >= bestScore - 0.02);
  const distinctPoints = [];
  for (const candidate of best) {
    const samePoint = distinctPoints.some((point) =>
      Math.hypot(point.easting - candidate.easting, point.northing - candidate.northing) <= 5
    );
    if (!samePoint) distinctPoints.push(candidate);
  }
  if (distinctPoints.length !== 1) {
    if (distinctPoints.length > 1) ambiguous.push({ udrId: row.udr_id, candidates: distinctPoints.length });
    unresolved.push({
      udr_id: row.udr_id,
      address: row.sjediste,
      street: row.street,
      city: row.city,
      reason: distinctPoints.length > 1 ? "ambiguous" : "unmatched",
      candidate_count: distinctPoints.length,
    });
    continue;
  }

  const candidate = distinctPoints[0];
  const [longitude, latitude] = proj4(EPSG_3035, EPSG_4326, [candidate.easting, candidate.northing]);
  if (latitude < 42 || latitude > 47 || longitude < 13 || longitude > 20) {
    ambiguous.push({ udrId: row.udr_id, candidates: 1, reason: "coordinate_outside_croatia" });
    unresolved.push({
      udr_id: row.udr_id,
      address: row.sjediste,
      street: row.street,
      city: row.city,
      reason: "coordinate_outside_croatia",
      candidate_count: 1,
    });
    continue;
  }
  const match = {
    udr_id: row.udr_id,
    latitude: Number(latitude.toFixed(8)),
    longitude: Number(longitude.toFixed(8)),
    dgu_address_id: candidate.dguId,
    matched_address: candidate.dguAddress,
    match_method: candidate.method,
    source: "dgu_inspire_addresses",
    confidence: "building",
  };
  matches.push(match);
  methodCounts.set(candidate.method, (methodCounts.get(candidate.method) ?? 0) + 1);
  if (Number.isFinite(row.lat) && Number.isFinite(row.lng)) {
    existingDistances.push(haversineMeters(row.lat, row.lng, latitude, longitude));
  }
}

existingDistances.sort((left, right) => left - right);
const percentile = (values, ratio) => values.length
  ? values[Math.min(values.length - 1, Math.floor(values.length * ratio))]
  : null;

if (outputPath) {
  const output = fs.createWriteStream(path.resolve(outputPath), { encoding: "utf8" });
  for (const match of matches) output.write(`${JSON.stringify(match)}\n`);
  await new Promise((resolve, reject) => {
    output.on("error", reject);
    output.end(resolve);
  });
}

if (unresolvedOutputPath) {
  fs.writeFileSync(path.resolve(unresolvedOutputPath), `${JSON.stringify(unresolved, null, 2)}\n`);
}

console.log(JSON.stringify({
  dataset: DGU_DATASET_URL,
  archive: path.resolve(archivePath),
  active_registry_rows: registryRows.length,
  usable_registry_addresses: registryRows.length - unusableRegistryAddresses,
  unusable_registry_addresses: unusableRegistryAddresses,
  dgu_addresses_scanned: dguAddressesScanned,
  malformed_dgu_addresses: malformedDguAddresses,
  parsed_dgu_addresses: parsedDguAddresses,
  fuzzy_bucket_hits: fuzzyBucketHits,
  fuzzy_score_accepted: fuzzyScoreAccepted,
  unique_building_matches: matches.length,
  match_rate_percent: Number((matches.length / registryRows.length * 100).toFixed(2)),
  ambiguous_registry_rows: ambiguous.length,
  unmatched_registry_rows: registryRows.length - matches.length - ambiguous.length,
  match_methods: Object.fromEntries([...methodCounts].sort((a, b) => b[1] - a[1])),
  existing_geocode_comparison: {
    compared: existingDistances.length,
    median_distance_m: percentile(existingDistances, 0.5) == null
      ? null
      : Math.round(percentile(existingDistances, 0.5)),
    p95_distance_m: percentile(existingDistances, 0.95) == null
      ? null
      : Math.round(percentile(existingDistances, 0.95)),
  },
  output: outputPath ? path.resolve(outputPath) : null,
  unresolved_output: unresolvedOutputPath ? path.resolve(unresolvedOutputPath) : null,
}, null, 2));
