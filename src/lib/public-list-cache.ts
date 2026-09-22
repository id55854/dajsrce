/** Short-lived snapshots of public lists only; private user state stays outside. */
type PublicListKey = "/api/volunteer-events" | `/api/needs?${string}`;
const MAX_ENTRIES = 20;
const TTL_MS = 30_000;
const snapshots = new Map<PublicListKey, { value: unknown; at: number }>();

export function readPublicList<T>(key: PublicListKey): T | undefined {
  const snapshot = snapshots.get(key);
  if (!snapshot) return undefined;
  if (Date.now() - snapshot.at >= TTL_MS) {
    snapshots.delete(key);
    return undefined;
  }
  return snapshot.value as T;
}

export function rememberPublicList<T>(key: PublicListKey, value: T): void {
  snapshots.delete(key);
  snapshots.set(key, { value, at: Date.now() });
  if (snapshots.size > MAX_ENTRIES) {
    snapshots.delete(snapshots.keys().next().value!);
  }
}
