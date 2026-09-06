import { createClient } from "@supabase/supabase-js";
import { missingPublicSupabaseKeys } from "@/lib/env";

/**
 * Raised when the process has no usable public Supabase credentials.
 *
 * A missing configuration and a database outage produce the same empty page
 * but need opposite responses: an outage is transient and worth retrying, a
 * missing `.env.local` will keep failing until someone fills it in. Reporting
 * both as "temporarily unavailable" is what makes a fresh clone's blank map
 * look like somebody else's problem.
 *
 * `missing` carries variable *names* only — never values — so it stays safe to
 * log, and routes still withhold it from production responses.
 */
export class PublicSupabaseConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Public Supabase configuration is missing: ${missing.join(", ")}`);
    this.name = "PublicSupabaseConfigError";
  }
}

/**
 * Stateless client for cacheable public-data routes. It intentionally does not
 * read cookies or create an authenticated session, so public map requests do
 * not become personalised cache entries.
 */
export function createPublicSupabaseClient() {
  const missing = missingPublicSupabaseKeys();
  if (missing.length > 0) {
    throw new PublicSupabaseConfigError(missing);
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    }
  );
}

/** Postgres `query_canceled` — the statement hit the role's timeout. */
export const STATEMENT_TIMEOUT_CODE = "57014";

type RpcCapableClient = {
  rpc: (fn: string, parameters: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

/**
 * One RPC call, retried exactly once if the statement was cancelled.
 *
 * Supabase gives `anon` a three-second statement timeout, and the first
 * registry-wide query after a project has been idle spends most of that budget
 * faulting indexes in from disk rather than doing work. In production the CDN
 * hides it — one warm response serves everyone — but a local dev server has no
 * CDN in front of it, so without this every `next dev` would open on an empty
 * map and a "temporarily unavailable" notice. The cancelled attempt still
 * leaves the pages it touched in the buffer cache, which is what makes the
 * immediate second attempt land.
 *
 * Only a timeout is retried, and only once: a genuine failure must not cost
 * the visitor two full timeouts before it is reported.
 */
export async function rpcWithTimeoutRetry<T extends RpcCapableClient>(
  supabase: T,
  fn: string,
  parameters: Record<string, unknown>
) {
  const first = await supabase.rpc(fn, parameters);
  if (first.error?.code !== STATEMENT_TIMEOUT_CODE) return first;
  return supabase.rpc(fn, parameters);
}
