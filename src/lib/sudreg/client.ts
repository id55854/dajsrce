// Thin SudReg API client.
//
// Auth: OAuth2 Client Credentials. The bearer token (`expires_in: 21600s`) is
// cached in module memory for the life of the Node process. SudReg rate-
// limits /detalji_subjekta to 6 req/min per client, so callers should wrap
// in their own caching layer when they expect bursts.

import type { RawDetaljiSubjekta, SudregCompany } from "./types";

const TOKEN_TTL_BUFFER_S = 300; // refresh 5 min before stated expiry

type CachedToken = { token: string; expiresAt: number };
let cached: CachedToken | null = null;

function defaultBaseUrl(): string {
  return process.env.SUDREG_API_URL?.replace(/\/$/, "") ?? "https://sudreg-data.gov.hr";
}

export class SudregError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "SudregError";
  }
}

export class SudregNotFoundError extends SudregError {
  constructor() {
    super("Subject not found in SudReg", 404);
    this.name = "SudregNotFoundError";
  }
}

export class SudregRateLimitError extends SudregError {
  constructor() {
    super("Rate limit exceeded — try again in a minute", 429);
    this.name = "SudregRateLimitError";
  }
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - TOKEN_TTL_BUFFER_S > now) {
    return cached.token;
  }

  const id = process.env.SUDREG_CLIENT_ID;
  const secret = process.env.SUDREG_CLIENT_SECRET;
  if (!id || !secret) {
    throw new SudregError(
      "SudReg credentials not configured (set SUDREG_CLIENT_ID and SUDREG_CLIENT_SECRET in .env.local)",
      500
    );
  }

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(`${defaultBaseUrl()}/api/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new SudregError(`SudReg token endpoint returned ${res.status}`, res.status);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new SudregError("SudReg token response missing access_token", 502);
  }
  const ttl = typeof data.expires_in === "number" ? data.expires_in : 21600;
  cached = { token: data.access_token, expiresAt: now + ttl };
  return data.access_token;
}

export async function lookupCompany(oib: string): Promise<SudregCompany> {
  const trimmed = (oib ?? "").trim();
  if (!/^\d{11}$/.test(trimmed)) {
    throw new SudregError("OIB must be 11 digits", 400);
  }

  const token = await getAccessToken();
  const url = new URL(`${defaultBaseUrl()}/api/javni/detalji_subjekta`);
  url.searchParams.set("tip_identifikatora", "oib");
  url.searchParams.set("identifikator", trimmed);
  url.searchParams.set("expand_relations", "true");

  // Per the OpenAPI spec, omit_nulls defaults to "ON" so missing fields are
  // simply absent from the response — we already treat each field as optional.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) throw new SudregNotFoundError();
  if (res.status === 429) throw new SudregRateLimitError();
  if (!res.ok) throw new SudregError(`SudReg ${res.status}`, res.status);

  const raw = (await res.json()) as RawDetaljiSubjekta;
  return normalize(trimmed, raw);
}

function normalize(oib: string, raw: RawDetaljiSubjekta): SudregCompany {
  const sjediste = raw.sjediste ?? {};
  const street =
    sjediste.ulica && sjediste.kucni_broj != null
      ? `${sjediste.ulica} ${sjediste.kucni_broj}`
      : sjediste.ulica ?? null;
  const emails = Array.from(
    new Set(
      (raw.email_adrese ?? [])
        .map((e) => e.adresa?.trim())
        .filter((e): e is string => Boolean(e && e.includes("@")))
    )
  );
  return {
    oib: raw.potpuni_oib ?? String(raw.oib ?? oib),
    legalName: raw.tvrtka?.ime?.trim() ?? "",
    shortName: raw.skracena_tvrtka?.ime?.trim() ?? null,
    legalForm: raw.pravni_oblik?.vrsta_pravnog_oblika?.naziv?.trim() ?? null,
    street,
    city: sjediste.naziv_naselja?.trim() ?? null,
    county: sjediste.naziv_zupanije?.trim() ?? null,
    emails,
    mb: raw.mb != null ? String(raw.mb) : null,
    mbs: raw.potpuni_mbs ?? (raw.mbs != null ? String(raw.mbs) : null),
    status: raw.status ?? null,
    foundingDate: raw.datum_osnivanja ? raw.datum_osnivanja.slice(0, 10) : null,
    fetchedAt: new Date().toISOString(),
  };
}
