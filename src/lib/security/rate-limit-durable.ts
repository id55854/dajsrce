import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/observability";
import {
  NO_STORE,
  jsonError,
  rateLimit,
  withRequestId,
  type RateLimitOptions,
} from "@/lib/security/http";

export type SharedRateLimit = "allowed" | "limited";

type ConsumeRateLimit = (
  key: string,
  limit: number,
  windowMs: number
) => Promise<SharedRateLimit>;

/**
 * The in-memory limiter is a cheap first door on one instance. Password
 * recovery and claim tokens are guessed across many instances, so the shared
 * Postgres bucket is what actually enforces the budget.
 *
 * Public map reads stay on the in-memory limiter: a database write on every
 * viewport request would fight the map latency budget, and those routes do
 * not authenticate anyone.
 */
export async function rateLimitDurable(
  req: NextRequest,
  options: RateLimitOptions,
  requestId?: string,
  consume: ConsumeRateLimit = consumeSharedRateLimit
): Promise<NextResponse | null> {
  const local = rateLimit(req, options, requestId);
  if (local) return local;

  const identity = options.identifier?.trim() || clientAddress(req);
  try {
    const outcome = await consume(`${options.name}:${identity}`, options.limit, options.windowMs);
    if (outcome === "allowed") return null;
    return tooMany(requestId);
  } catch (error) {
    if (isMissingRateLimitFunction(error) || process.env.NODE_ENV !== "production") {
      if (process.env.NODE_ENV === "production") {
        logError("rate_limit.shared_missing", error, { request_id: requestId, bucket: options.name });
      }
      return null;
    }
    logError("rate_limit.shared_failed", error, { request_id: requestId, bucket: options.name });
    return jsonError("Too many requests", 503, requestId, NO_STORE);
  }
}

async function consumeSharedRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<SharedRateLimit> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_ms: windowMs,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || typeof (data as { allowed?: unknown }).allowed !== "boolean") {
    throw new Error("rate_limit_unavailable");
  }
  return (data as { allowed: boolean }).allowed ? "allowed" : "limited";
}

function tooMany(requestId?: string): NextResponse {
  return NextResponse.json(
    { error: "Too many requests", request_id: requestId },
    {
      status: 429,
      headers: withRequestId({ ...NO_STORE, "Retry-After": "60" }, requestId),
    }
  );
}

function clientAddress(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "local";
}

function isMissingRateLimitFunction(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return (
    code === "PGRST202" ||
    code === "42883" ||
    message.includes("consume_rate_limit") ||
    /could not find the function/i.test(message) ||
    /does not exist/i.test(message)
  );
}
