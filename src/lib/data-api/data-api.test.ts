import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDataApiFetch } from "./fetch";
import {
  DATA_API_AUDIENCE,
  anonDataApiToken,
  resetDataApiTokenCache,
  serviceDataApiToken,
  userDataApiToken,
} from "./token";

const SUPABASE = "https://project.supabase.co";
const NEON = "https://ep-x.apirest.neon.tech/neondb/rest/v1";

describe("createDataApiFetch", () => {
  it("moves database calls to Neon with the Data API token and drops the Supabase key", async () => {
    const baseFetch = vi.fn(async () => new Response("[]"));
    const fetcher = createDataApiFetch({
      supabaseUrl: SUPABASE,
      dataApiUrl: NEON,
      getToken: async () => "data-token",
      baseFetch,
    });

    await fetcher(`${SUPABASE}/rest/v1/needs?select=id`, {
      headers: { apikey: "anon-key", Authorization: "Bearer anon-key" },
    });

    const [url, init] = baseFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${NEON}/needs?select=id`);
    const headers = new Headers(init.headers);
    expect(headers.get("apikey")).toBeNull();
    expect(headers.get("authorization")).toBe("Bearer data-token");
  });

  it("leaves Supabase Auth traffic untouched", async () => {
    const baseFetch = vi.fn(async () => new Response("{}"));
    const getToken = vi.fn(async () => "data-token");
    const fetcher = createDataApiFetch({ supabaseUrl: SUPABASE, dataApiUrl: NEON, getToken, baseFetch });
    const init = { headers: { apikey: "anon-key" } };

    await fetcher(`${SUPABASE}/auth/v1/user`, init);
    await fetcher(`${SUPABASE}/rest/v1beta/needs`, init);

    expect(baseFetch.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      `${SUPABASE}/auth/v1/user`,
      `${SUPABASE}/rest/v1beta/needs`,
    ]);
    expect(getToken).not.toHaveBeenCalled();
  });
});

describe("Data API tokens", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const original = process.env.DATA_API_JWT_PRIVATE_JWK;

  beforeEach(() => {
    process.env.DATA_API_JWT_PRIVATE_JWK = JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "test-kid" });
    resetDataApiTokenCache();
  });
  afterEach(() => {
    process.env.DATA_API_JWT_PRIVATE_JWK = original;
    resetDataApiTokenCache();
  });

  function decode(token: string) {
    const [header, payload, signature] = token.split(".");
    const valid = verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url")
    );
    return {
      valid,
      header: JSON.parse(Buffer.from(header, "base64url").toString()),
      claims: JSON.parse(Buffer.from(payload, "base64url").toString()),
    };
  }

  it("signs verifiable ES256 tokens scoped to the Data API audience", async () => {
    const { valid, header, claims } = decode(await anonDataApiToken());
    expect(valid).toBe(true);
    expect(header).toMatchObject({ alg: "ES256", kid: "test-kid" });
    expect(claims).toMatchObject({ role: "anon", aud: DATA_API_AUDIENCE });
    expect(claims.sub).toBeUndefined();
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
  });

  it("binds user tokens to the verified user and never grants more than authenticated", async () => {
    const { token } = await userDataApiToken({
      id: "11111111-1111-4111-8111-111111111111",
      email: "a@example.com",
      name: "A",
    });
    const { claims } = decode(token);
    expect(claims).toMatchObject({
      role: "authenticated",
      sub: "11111111-1111-4111-8111-111111111111",
      email: "a@example.com",
      user_metadata: { name: "A" },
    });
  });

  it("reuses the shared anon and service tokens while they are fresh", async () => {
    expect(await anonDataApiToken()).toBe(await anonDataApiToken());
    const service = decode(await serviceDataApiToken());
    expect(service.claims.role).toBe("service_role");
  });

  it("fails closed without a signing key", async () => {
    delete process.env.DATA_API_JWT_PRIVATE_JWK;
    resetDataApiTokenCache();
    await expect(anonDataApiToken()).rejects.toThrow(/DATA_API_JWT_PRIVATE_JWK/);
  });
});
