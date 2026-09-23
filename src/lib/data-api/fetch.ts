/**
 * Routes a supabase-js client's database traffic to the Neon Data API.
 *
 * supabase-js sends table and RPC requests to `<supabaseUrl>/rest/v1/...`
 * (PostgREST) and auth requests to `<supabaseUrl>/auth/v1/...`. Only the first
 * moved to Neon: this fetch rewrites `/rest/v1` onto the Data API, swaps the
 * Supabase key for a Data API token, and passes everything else, including
 * every Auth call, through untouched. Call sites keep their `.from()`/`.rpc()`
 * code; only the client factories change.
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

export function createDataApiFetch({
  supabaseUrl,
  dataApiUrl,
  getToken,
  baseFetch,
}: DataApiFetchOptions): FetchLike {
  const restPrefix = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1`;
  const target = dataApiUrl.replace(/\/+$/, "");

  return async (input, init) => {
    const doFetch = baseFetch ?? fetch;
    const url = requestUrl(input);
    if (!url.startsWith(restPrefix)) return doFetch(input, init);
    const rest = url.slice(restPrefix.length);
    if (rest !== "" && !rest.startsWith("/") && !rest.startsWith("?")) return doFetch(input, init);

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    // The Supabase key means nothing to Neon and must not leave for it.
    headers.delete("apikey");
    headers.set("Authorization", `Bearer ${await getToken()}`);

    if (input instanceof Request && !init) {
      return doFetch(new Request(target + rest, input), { headers });
    }
    return doFetch(target + rest, { ...init, headers });
  };
}
