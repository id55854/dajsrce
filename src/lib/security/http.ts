import { NextRequest, NextResponse } from "next/server";
import { safeInternalPath } from "./redirects";

type HeadersInit = NonNullable<ConstructorParameters<typeof Headers>[0]>;

type RateLimitOptions = {
  name: string;
  limit: number;
  windowMs: number;
  identifier?: string | null;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_TOKEN = /^[A-Za-z0-9_-]{32,256}$/;
const RATE_LIMIT_MAX_BUCKETS = 5000;

const rateLimitStore = globalThis as typeof globalThis & {
  __dajsrceRateLimitStore?: Map<string, RateLimitBucket>;
};

const buckets = rateLimitStore.__dajsrceRateLimitStore ?? new Map<string, RateLimitBucket>();
rateLimitStore.__dajsrceRateLimitStore = buckets;

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export { safeInternalPath };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isBase64UrlToken(value: unknown): value is string {
  return typeof value === "string" && BASE64URL_TOKEN.test(value);
}

export function jsonError(
  error: string,
  status: number,
  requestId?: string,
  headers?: HeadersInit
) {
  return NextResponse.json(
    requestId ? { error, request_id: requestId } : { error },
    { status, headers: withRequestId(headers, requestId) }
  );
}

export function withRequestId(headers?: HeadersInit, requestId?: string): Headers {
  const next = new Headers(headers);
  if (requestId) next.set("x-request-id", requestId);
  return next;
}

export function requireSameOrigin(req: NextRequest, requestId?: string): NextResponse | null {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())) return null;

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return jsonError("Invalid request origin", 403, requestId, NO_STORE);
  }

  const origin = req.headers.get("origin");
  if (!origin) {
    return process.env.NODE_ENV === "production"
      ? jsonError("Invalid request origin", 403, requestId, NO_STORE)
      : null;
  }

  try {
    if (new URL(origin).origin === req.nextUrl.origin) return null;
  } catch {
    return jsonError("Invalid request origin", 403, requestId, NO_STORE);
  }

  return jsonError("Invalid request origin", 403, requestId, NO_STORE);
}

export function rateLimit(
  req: NextRequest,
  options: RateLimitOptions,
  requestId?: string
): NextResponse | null {
  const now = Date.now();
  if (buckets.size > RATE_LIMIT_MAX_BUCKETS) pruneBuckets(now);

  const identity = options.identifier?.trim() || clientAddress(req);
  const key = `${options.name}:${identity}`;
  const bucket = buckets.get(key);
  const nextBucket =
    !bucket || bucket.resetAt <= now
      ? { count: 1, resetAt: now + options.windowMs }
      : { count: bucket.count + 1, resetAt: bucket.resetAt };

  buckets.set(key, nextBucket);

  if (nextBucket.count <= options.limit) return null;

  const retryAfter = Math.max(1, Math.ceil((nextBucket.resetAt - now) / 1000));
  return NextResponse.json(
    { error: "Too many requests", request_id: requestId },
    {
      status: 429,
      headers: withRequestId(
        {
          ...NO_STORE,
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(options.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(nextBucket.resetAt / 1000)),
        },
        requestId
      ),
    }
  );
}

function clientAddress(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "local";
}

function pruneBuckets(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
