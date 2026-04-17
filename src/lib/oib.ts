// OIB (Osobni identifikacijski broj) helpers.
//
// - isValidOib performs the statutory mod 11,10 checksum on an 11-digit OIB.
// - lookupOib attempts a best-effort lookup via OIB_LOOKUP_URL (Croatian
//   sudski registar public endpoint). It is resilient: on network error,
//   timeout, or missing env var it returns null and the caller should fall
//   back to format-only validation.

export type OibLookupResult = {
  legalName: string;
  address: string | null;
  city: string | null;
  isActive: boolean;
};

export function isValidOib(oib: string): boolean {
  const digits = (oib ?? "").trim();
  if (!/^\d{11}$/.test(digits)) return false;

  // ISO 7064, MOD 11,10.
  let remainder = 10;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder + Number.parseInt(digits[i]!, 10)) % 10;
    if (remainder === 0) remainder = 10;
    remainder = (remainder * 2) % 11;
  }
  const check = (11 - remainder) % 10;
  return check === Number.parseInt(digits[10]!, 10);
}

export async function lookupOib(oib: string, timeoutMs = 3000): Promise<OibLookupResult | null> {
  if (!isValidOib(oib)) return null;

  const url = process.env.OIB_LOOKUP_URL;
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${url}?oib=${encodeURIComponent(oib)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return null;

    // We don't know the remote shape; map a few common aliases defensively.
    const obj = data as Record<string, unknown>;
    const legal = pick(obj, ["legalName", "legal_name", "naziv", "name"]);
    if (!legal) return null;
    return {
      legalName: String(legal),
      address: toStrOrNull(pick(obj, ["address", "adresa", "street"])),
      city: toStrOrNull(pick(obj, ["city", "grad", "mjesto"])),
      isActive: Boolean(pick(obj, ["isActive", "active", "aktivan"]) ?? true),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function toStrOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value);
  return s.length ? s : null;
}
