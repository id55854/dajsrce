const LOCAL_ORIGIN = "https://dajsrce.local";
const INTERNAL_PATH_MAX_LENGTH = 2048;

/**
 * One leading slash and nothing a browser could read as another host: no
 * protocol-relative `//host`, no backslash (browsers treat `\` as `/`) and no
 * control characters.
 */
function isPlainInternalPath(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function safeInternalPath(
  raw: string | null | undefined,
  fallback = "/dashboard"
): string {
  const value = raw?.trim();
  if (!value) return fallback;
  if (value.length > INTERNAL_PATH_MAX_LENGTH || !isPlainInternalPath(value)) {
    return fallback;
  }

  try {
    const url = new URL(value, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN) return fallback;
    // The parser resolves dot segments, so "/.//evil.example",
    // "/%2e//evil.example" and "/a/..//evil.example" only become the
    // protocol-relative "//evil.example" here, after the check above. The
    // router navigates to this normalised form, so it has to pass the same
    // rules again and still resolve to this origin.
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (!isPlainInternalPath(path)) return fallback;
    if (new URL(path, LOCAL_ORIGIN).origin !== LOCAL_ORIGIN) return fallback;
    return path;
  } catch {
    return fallback;
  }
}
