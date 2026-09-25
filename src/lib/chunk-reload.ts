/**
 * Recovery from a stale bundle after a deploy.
 *
 * A tab opened on the previous build asks for code-split chunks by that
 * build's hashed names; once a new deployment is live they 404 (or come back
 * as a text/plain error page), webpack throws a ChunkLoadError and the route
 * error boundary shows "something went wrong". The fix is simply to load the
 * current build, so the boundary reloads once instead. A short sessionStorage
 * guard keeps a genuinely missing chunk from turning into a reload loop.
 */
const GUARD_KEY = "dajsrce:chunk-reload-at";
const GUARD_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "ChunkLoadError") return true;
  return typeof message === "string" && /Loading (CSS )?chunk [\w-]+ failed/i.test(message);
}

/** Reloads the page for a stale-bundle error; returns whether it did. */
export function reloadOnceForChunkError(error: unknown, now = Date.now()): boolean {
  if (typeof window === "undefined" || !isChunkLoadError(error)) return false;
  try {
    const last = Number(window.sessionStorage.getItem(GUARD_KEY) ?? 0);
    if (now - last < GUARD_MS) return false;
    window.sessionStorage.setItem(GUARD_KEY, String(now));
  } catch {
    // Storage unavailable: still reload, a loop needs storage to be detected.
  }
  window.location.reload();
  return true;
}
