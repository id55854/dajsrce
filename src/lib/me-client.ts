"use client";

/**
 * One `/api/me` round trip per page load, shared by every component that
 * needs the signed-in profile (Navbar, the donate surface, the needs list).
 *
 * The root layout deliberately does not read cookies (see CLAUDE.md), so the
 * profile cannot arrive as a server prop without making every page dynamic.
 * The next best thing is to make sure the browser asks for it once, not once
 * per component. The memo lives for a short window and is dropped on any auth
 * state change, so a sign-in or sign-out is never served a stale answer.
 */

export type MeProfile = {
  id: string;
  email: string;
  name: string;
  role: string;
  institution_id: string | null;
};

type MeResponse = { profile: MeProfile | null };

const TTL_MS = 30_000;

let cached: { at: number; promise: Promise<MeProfile | null> } | null = null;

export function fetchMe(): Promise<MeProfile | null> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.promise;

  const promise = fetch("/api/me", { credentials: "include" })
    .then((response) => (response.ok ? (response.json() as Promise<MeResponse>) : null))
    .then((json) => json?.profile ?? null)
    .catch(() => {
      // A failed lookup must not be remembered as "signed out" for 30 s.
      cached = null;
      return null;
    });

  cached = { at: now, promise };
  return promise;
}

export function invalidateMe(): void {
  cached = null;
}
