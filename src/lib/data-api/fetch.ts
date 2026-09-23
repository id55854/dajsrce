/**
 * Routes a supabase-js client's database traffic to the Neon Data API.
 *
 * supabase-js sends table and RPC requests to `<supabaseUrl>/rest/v1/...`
 * (PostgREST) and auth requests to `<supabaseUrl>/auth/v1/...`. Only the first
 * moved to Neon: this fetch rewrites `/rest/v1` onto the Data API, swaps the
 * Supabase key for a Data API token, and passes everything else, including
 * every Auth call, through untouched. Call sites keep their `.from()`/`.rpc()`
 * code; only the client factories change.
 *
 * URLs are compared parsed, not as strings: supabase-js normalises the project
 * URL itself, so an env value with stray whitespace or a trailing slash must
 * still match. And it fails closed: a `/rest/v1` request that does not match
 * the configured project throws instead of reaching the retired database.
 */

type FetchLike = typeof fetch;

export type DataApiFetchOptions = {
  supabaseUrl: string;
  dataApiUrl: string;
  /** The bearer token for one request; resolved per request, never cached here. */
  getToken: () => Promise<string>;
  baseFetch?: FetchLike;
};

export function getDataApiUrl(env: Record<string, string | undefined> = process.env): string {
  const value = env.NEXT_PUBLIC_DATA_API_URL?.trim();
  if (!value) throw new Error("Missing environment variable: NEXT_PUBLIC_DATA_API_URL");
  return value.replace(/\/+$/, "");
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const REST_SEGMENT = /\/rest\/v1(?=\/|$)/;

export function createDataApiFetch({
  supabaseUrl,
  dataApiUrl,
  getToken,
  baseFetch,
}: DataApiFetchOptions): FetchLike {
  const base = new URL(supabaseUrl.trim());
  const restPrefix = `${base.origin}${base.pathname.replace(/\/+$/, "")}/rest/v1`;
  const target = dataApiUrl.trim().replace(/\/+$/, "");

  return async (input, init) => {
    const doFetch = baseFetch ?? fetch;
    const parsed = new URL(requestUrl(input));
    const path = `${parsed.origin}${parsed.pathname}`;
    const matches = path === restPrefix || path.startsWith(`${restPrefix}/`);
    if (!matches) {
      if (parsed.origin === base.origin && REST_SEGMENT.test(parsed.pathname)) {
        throw new Error("Refusing to send a database request to the retired Supabase database");
      }
      return doFetch(input, init);
    }

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    // The Supabase key means nothing to Neon and must not leave for it.
    headers.delete("apikey");
    headers.set("Authorization", `Bearer ${await getToken()}`);

    const destination = `${target}${path.slice(restPrefix.length)}${parsed.search}`;
    if (input instanceof Request && !init) {
      return doFetch(new Request(destination, input), { headers });
    }
    return doFetch(destination, { ...init, headers });
  };
}
