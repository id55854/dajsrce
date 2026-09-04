const LOCAL_ORIGIN = "https://dajsrce.local";
const INTERNAL_PATH_MAX_LENGTH = 2048;

export function safeInternalPath(
  raw: string | null | undefined,
  fallback = "/dashboard"
): string {
  const value = raw?.trim();
  if (!value) return fallback;
  if (
    value.length > INTERNAL_PATH_MAX_LENGTH ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const url = new URL(value, LOCAL_ORIGIN);
    if (url.origin !== LOCAL_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
