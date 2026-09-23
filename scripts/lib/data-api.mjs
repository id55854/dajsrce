// Neon Data API access for scripts: the .mjs twin of src/lib/data-api/{token,fetch}.ts.
// Scripts keep using supabase-js; its /rest/v1 traffic is rewritten onto the
// Data API with a token this process signs (DATA_API_JWT_PRIVATE_JWK). Keep the
// claims in step with src/lib/data-api/token.ts.

const AUDIENCE = "dajsrce-data-api";
const ISSUER = "dajsrce";
const LIFETIME_SECONDS = 10 * 60;

let keyPromise = null;
const cache = {};

function loadKey() {
  keyPromise ??= (async () => {
    const raw = process.env.DATA_API_JWT_PRIVATE_JWK?.trim();
    if (!raw) throw new Error("Missing DATA_API_JWT_PRIVATE_JWK (see .env.example)");
    const jwk = JSON.parse(raw);
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.kid) {
      throw new Error("DATA_API_JWT_PRIVATE_JWK must be a private P-256 JWK with a kid");
    }
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
    return { key, kid: jwk.kid };
  })();
  return keyPromise;
}

const b64url = (input) =>
  Buffer.from(typeof input === "string" ? input : new Uint8Array(input)).toString("base64url");

/** @param {"anon" | "service_role"} role */
export async function dataApiToken(role) {
  const now = Math.floor(Date.now() / 1000);
  if (cache[role] && cache[role].exp - 60 > now) return cache[role].token;
  const { key, kid } = await loadKey();
  const exp = now + LIFETIME_SECONDS;
  const header = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
  const payload = b64url(JSON.stringify({ role, iss: ISSUER, aud: AUDIENCE, iat: now, exp }));
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  const token = `${header}.${payload}.${b64url(signature)}`;
  cache[role] = { token, exp };
  return token;
}

export function dataApiUrl() {
  const value = process.env.NEXT_PUBLIC_DATA_API_URL?.trim();
  if (!value) throw new Error("Missing NEXT_PUBLIC_DATA_API_URL (see .env.example)");
  return value.replace(/\/+$/, "");
}

/** supabase-js `global.fetch` that sends database calls to Neon as `role`. */
export function dataApiFetch(supabaseUrl, role) {
  const prefix = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1`;
  const target = dataApiUrl();
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(prefix)) return fetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.delete("apikey");
    headers.set("Authorization", `Bearer ${await dataApiToken(role)}`);
    return fetch(target + url.slice(prefix.length), { ...init, headers });
  };
}
