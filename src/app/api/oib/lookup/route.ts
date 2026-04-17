import { NextRequest, NextResponse } from "next/server";
import { isValidOib, lookupOib } from "@/lib/oib";

// Per-IP in-memory sliding window. Sufficient for MVP; replace with a
// durable limiter (e.g. Upstash) before public launch.
const WINDOW_MS = 60_000;
const MAX_HITS = 20;
const buckets = new Map<string, number[]>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip)?.filter((t) => now - t < WINDOW_MS) ?? [];
  if (bucket.length >= MAX_HITS) {
    buckets.set(ip, bucket);
    return false;
  }
  bucket.push(now);
  buckets.set(ip, bucket);
  return true;
}

export async function GET(req: NextRequest) {
  const oib = req.nextUrl.searchParams.get("oib")?.trim() ?? "";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (!rateLimit(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!isValidOib(oib)) {
    return NextResponse.json({ valid: false, reason: "checksum_failed" }, { status: 200 });
  }

  const hit = await lookupOib(oib);
  return NextResponse.json({ valid: true, registry: hit });
}
