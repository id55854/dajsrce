/**
 * Which version of the terms of use and privacy policy an account accepted.
 *
 * Recorded in Supabase user metadata at sign-up (email/password) or on
 * /auth/setup (Google sign-ins, which never see the register form). User
 * metadata is user-writable, so this decides whether to ask again and is kept
 * as the account's own statement; it never grants or gates anything
 * server-side.
 */

/** Bump when the terms or the privacy policy change materially; setup asks again. */
export const TERMS_VERSION = "2026-09-27";

export const TERMS_HREF = "/uvjeti-koristenja";
export const PRIVACY_HREF = "/pravila-privatnosti";

export type TermsAcceptance = {
  terms_version: string;
  terms_accepted_at: string;
};

export function termsAcceptance(now: Date = new Date()): TermsAcceptance {
  return { terms_version: TERMS_VERSION, terms_accepted_at: now.toISOString() };
}

export function hasAcceptedCurrentTerms(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  return (
    metadata?.terms_version === TERMS_VERSION &&
    typeof metadata.terms_accepted_at === "string" &&
    metadata.terms_accepted_at.length > 0
  );
}
