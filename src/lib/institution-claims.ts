/**
 * "I am this association" is a reviewed claim against the official Croatian
 * Associations Register, not a free-text assertion. Everything here is shape
 * and bounds only, authorisation lives in the transactional RPCs, which read
 * the actor's role from `public.profiles` inside the transaction.
 */

export const INSTITUTION_CLAIM_STATUSES = [
  "pending",
  "email_sent",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export type InstitutionClaimStatus = (typeof INSTITUTION_CLAIM_STATUSES)[number];

/** The states in which a claim still awaits a decision. */
export const OPEN_INSTITUTION_CLAIM_STATUSES: readonly InstitutionClaimStatus[] = [
  "pending",
  "email_sent",
];

export const CLAIM_SEARCH_MIN_QUERY_LENGTH = 2;
export const CLAIM_SEARCH_MAX_QUERY_LENGTH = 100;
export const CLAIM_SEARCH_DEFAULT_LIMIT = 10;
export const CLAIM_SEARCH_MAX_LIMIT = 25;

export const CLAIM_UDR_ID_MAX_LENGTH = 64;
export const CLAIM_CONTACT_EMAIL_MAX_LENGTH = 254;
export const CLAIM_NOTE_MAX_LENGTH = 2000;

/** How long a mailbox challenge stays valid. */
export const CLAIM_EMAIL_TOKEN_TTL_HOURS = 24;

/** Raw challenge tokens are 32 random bytes rendered as hex; only the SHA-256 digest is stored. */
export const CLAIM_EMAIL_TOKEN_BYTES = 32;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type ClaimState = "available" | "claimed" | "linked";

export type ClaimableAssociation = {
  id: string;
  name: string;
  short_name: string | null;
  status: string;
  address: string | null;
  city: string | null;
  county: string | null;
  registry_number: string | null;
  legal_form: string | null;
  registry_email: string | null;
  claim_state: ClaimState;
};

export type ClaimOrganisationSummary = {
  id: string;
  name: string | null;
  city: string | null;
  county: string | null;
  address: string | null;
  registry_email: string | null;
};

export type OwnInstitutionClaim = {
  id: string;
  status: InstitutionClaimStatus;
  udr_id: string;
  contact_email: string;
  evidence_note: string | null;
  email_verified: boolean;
  email_challenge_sent: boolean;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  organisation: ClaimOrganisationSummary | null;
};

export type InstitutionClaimReviewItem = {
  id: string;
  status: InstitutionClaimStatus;
  udr_id: string;
  contact_email: string;
  evidence_note: string | null;
  email_verified: boolean;
  email_challenge_sent: boolean;
  email_challenge_expires_at: string | null;
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  applicant: {
    id: string;
    name: string | null;
    email: string | null;
    role: string | null;
  };
  organisation:
    | (ClaimOrganisationSummary & {
        short_name: string | null;
        status: string;
        /** Not every schema version returns it; render only when present. */
        oib?: string | null;
        registry_number: string | null;
        legal_form: string | null;
        website: string | null;
        already_linked: boolean;
      })
    | null;
};

/** One page of the review queue. `total` counts every claim in the filter, not just this page. */
export type InstitutionClaimReviewPage = {
  items?: InstitutionClaimReviewItem[];
  limit?: number;
  total?: number;
};

export type ClaimRequestInput = {
  udrId: string;
  contactEmail: string;
  evidenceNote: string | null;
};

export type ClaimReviewInput = {
  decision: "approve" | "reject";
  note: string | null;
};

export type ClaimSearchInput = {
  query: string;
  county: string | null;
  limit: number;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function isInstitutionClaimStatus(value: unknown): value is InstitutionClaimStatus {
  return (
    typeof value === "string" &&
    (INSTITUTION_CLAIM_STATUSES as readonly string[]).includes(value)
  );
}

export function isOpenInstitutionClaim(status: InstitutionClaimStatus): boolean {
  return OPEN_INSTITUTION_CLAIM_STATUSES.includes(status);
}

/** A claim token is only ever seen as 64 lowercase hex characters server-side. */
export function isClaimTokenDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

/** The raw token as it travels in the email URL: hex, bounded, no separators. */
export function isRawClaimToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === CLAIM_EMAIL_TOKEN_BYTES * 2 &&
    /^[0-9a-fA-F]+$/.test(value)
  );
}

export function parseClaimRequestInput(raw: unknown): ParseResult<ClaimRequestInput> {
  const body = record(raw);
  if (!body) return { ok: false, error: "Request body must be an object" };

  const udrIdRaw = body.udr_id;
  if (typeof udrIdRaw !== "string") {
    return { ok: false, error: "udr_id is required" };
  }
  const udrId = udrIdRaw.trim();
  if (udrId.length < 1 || udrId.length > CLAIM_UDR_ID_MAX_LENGTH) {
    return {
      ok: false,
      error: `udr_id must contain 1-${CLAIM_UDR_ID_MAX_LENGTH} characters`,
    };
  }

  const emailRaw = body.contact_email;
  if (typeof emailRaw !== "string") {
    return { ok: false, error: "contact_email is required" };
  }
  const contactEmail = emailRaw.trim().toLowerCase();
  if (
    contactEmail.length > CLAIM_CONTACT_EMAIL_MAX_LENGTH ||
    !EMAIL_PATTERN.test(contactEmail)
  ) {
    return { ok: false, error: "contact_email is not a valid email address" };
  }

  const noteRaw = body.evidence_note;
  if (noteRaw != null && typeof noteRaw !== "string") {
    return { ok: false, error: "evidence_note must be text" };
  }
  const evidenceNote = typeof noteRaw === "string" ? noteRaw.trim() : "";
  if (evidenceNote.length > CLAIM_NOTE_MAX_LENGTH) {
    return {
      ok: false,
      error: `evidence_note must be at most ${CLAIM_NOTE_MAX_LENGTH} characters`,
    };
  }

  return {
    ok: true,
    value: { udrId, contactEmail, evidenceNote: evidenceNote || null },
  };
}

export function parseClaimReviewInput(raw: unknown): ParseResult<ClaimReviewInput> {
  const body = record(raw);
  if (!body) return { ok: false, error: "Request body must be an object" };

  const decision = body.decision;
  if (decision !== "approve" && decision !== "reject") {
    return { ok: false, error: "decision must be 'approve' or 'reject'" };
  }

  const noteRaw = body.note;
  if (noteRaw != null && typeof noteRaw !== "string") {
    return { ok: false, error: "note must be text" };
  }
  const note = typeof noteRaw === "string" ? noteRaw.trim() : "";
  if (note.length > CLAIM_NOTE_MAX_LENGTH) {
    return { ok: false, error: `note must be at most ${CLAIM_NOTE_MAX_LENGTH} characters` };
  }
  // A rejection the applicant cannot act on is not a review.
  if (decision === "reject" && note.length === 0) {
    return { ok: false, error: "A rejection must explain why" };
  }

  return { ok: true, value: { decision, note: note || null } };
}

export function parseClaimSearchInput(params: URLSearchParams): ParseResult<ClaimSearchInput> {
  const query = (params.get("q") ?? "").trim();
  if (
    query.length < CLAIM_SEARCH_MIN_QUERY_LENGTH ||
    query.length > CLAIM_SEARCH_MAX_QUERY_LENGTH
  ) {
    return {
      ok: false,
      error: `q must contain ${CLAIM_SEARCH_MIN_QUERY_LENGTH}-${CLAIM_SEARCH_MAX_QUERY_LENGTH} characters`,
    };
  }

  const countyRaw = (params.get("county") ?? "").trim();
  if (countyRaw.length > 100) return { ok: false, error: "county is too long" };

  const limitRaw = params.get("limit");
  let limit = CLAIM_SEARCH_DEFAULT_LIMIT;
  if (limitRaw != null && limitRaw !== "") {
    if (!/^\d+$/.test(limitRaw)) {
      return { ok: false, error: "limit must be an integer" };
    }
    limit = Number.parseInt(limitRaw, 10);
    if (limit < 1 || limit > CLAIM_SEARCH_MAX_LIMIT) {
      return {
        ok: false,
        error: `limit must be between 1 and ${CLAIM_SEARCH_MAX_LIMIT}`,
      };
    }
  }

  return { ok: true, value: { query, county: countyRaw || null, limit } };
}

/**
 * Map a Postgres error code raised by a claim RPC to a stable HTTP status.
 * The raw database message is never forwarded; it can name rows the caller
 * is not allowed to know exist.
 */
export function claimErrorStatus(code: string | null | undefined): number {
  switch (code) {
    case "42501":
      return 403;
    case "P0002":
      return 404;
    case "22023":
      return 400;
    case "23505":
    case "P0001":
      return 409;
    default:
      return 500;
  }
}

/**
 * Stable, client-facing reasons a claim RPC refused. Several different
 * conditions share one SQLSTATE (a 409 can mean "someone else claimed it" or
 * "you already have a request"), so the routes return this code next to their
 * opaque `error` and the browser picks the matching translated sentence. The
 * raw database message itself never leaves the server.
 */
export type ClaimErrorCode =
  | "account_ineligible"
  | "account_linked"
  | "open_claim_exists"
  | "organisation_claimed"
  | "organisation_linked"
  | "organisation_inactive"
  | "organisation_not_found"
  | "registry_unavailable"
  | "claim_not_found"
  | "claim_not_owned"
  | "claim_closed"
  | "no_registry_email"
  | "token_invalid"
  | "token_used"
  | "token_expired"
  | "reviewer_not_admin"
  | "applicant_linked"
  | "applicant_ineligible"
  | "no_location"
  | "mailbox_not_verified";

/** Fragments of the messages the claim RPCs raise, most specific first. */
const CLAIM_ERROR_MESSAGES: ReadonlyArray<readonly [string, ClaimErrorCode]> = [
  ["mailbox not verified", "mailbox_not_verified"],
  ["uq_institution_claims_open_per_profile", "open_claim_exists"],
  ["uq_institution_claims_open_per_udr", "organisation_claimed"],
  ["this account cannot claim", "account_ineligible"],
  ["this account is already linked", "account_linked"],
  ["an open claim already exists", "open_claim_exists"],
  ["already has a claim under review", "organisation_claimed"],
  ["already linked on the platform", "organisation_linked"],
  ["not active in the official register", "organisation_inactive"],
  ["not in the published registry snapshot", "organisation_not_found"],
  ["not in the canonical register", "organisation_not_found"],
  ["no registry snapshot is published", "registry_unavailable"],
  ["verification not found", "token_invalid"],
  ["invalid verification token", "token_invalid"],
  ["verification already used", "token_used"],
  ["verification expired", "token_expired"],
  ["claim not found", "claim_not_found"],
  ["does not belong to this account", "claim_not_owned"],
  ["claim is no longer open", "claim_closed"],
  ["publishes no email", "no_registry_email"],
  ["reviewer is not an administrator", "reviewer_not_admin"],
  ["applicant is already linked", "applicant_linked"],
  ["applicant role cannot hold", "applicant_ineligible"],
  ["no usable location", "no_location"],
];

export function claimErrorCode(error: {
  code?: string | null;
  message?: string | null;
}): ClaimErrorCode | null {
  const message = (error.message ?? "").toLowerCase();
  for (const [fragment, code] of CLAIM_ERROR_MESSAGES) {
    if (message.includes(fragment)) return code;
  }
  // A unique violation without a recognisable index name is still the
  // open-claim-per-organisation race: someone else's request landed first.
  return error.code === "23505" ? "organisation_claimed" : null;
}

/**
 * The applicant-facing sentence for a failed claim request, verification or
 * withdrawal: the stable code when the route supplied one, else the HTTP
 * status. Always a translation key, never server text.
 */
export function claimErrorMessageKey(status: number, code?: string | null): string {
  switch (code) {
    case "account_ineligible":
      return "claims.error_account_ineligible";
    case "account_linked":
      return "claims.error_account_linked";
    case "open_claim_exists":
      return "claims.error_open_claim_exists";
    case "organisation_claimed":
      return "claims.error_organisation_claimed";
    case "organisation_linked":
      return "claims.error_organisation_linked";
    case "organisation_inactive":
      return "claims.error_organisation_inactive";
    case "organisation_not_found":
      return "claims.error_organisation_not_found";
    case "claim_closed":
      return "claims.error_claim_closed";
    case "claim_not_found":
    case "claim_not_owned":
      return "claims.error_claim_missing";
    case "no_registry_email":
      return "claims.error_no_registry_email";
    case "registry_unavailable":
      return "claims.error_unavailable";
  }
  if (status === 401) return "auth.error_not_authenticated";
  if (status === 429) return "auth.error_rate_limited";
  if (status === 400) return "claims.error_invalid";
  if (status === 403) return "claims.error_forbidden";
  if (status === 409) return "claims.error_conflict";
  return "claims.error_unavailable";
}

/** The picker's error line. A failed search must never read as "no results". */
export function claimSearchErrorMessageKey(status: number): string {
  if (status === 401) return "auth.error_not_authenticated";
  if (status === 429) return "claims.search_error_rate_limited";
  return "claims.search_error";
}

/** The reviewer-facing sentence for a refused approve/reject. */
export function claimReviewErrorMessageKey(status: number, code?: string | null): string {
  switch (code) {
    case "mailbox_not_verified":
      return "admin.claims_error_mailbox_not_verified";
    case "claim_closed":
      return "admin.claims_error_claim_closed";
    case "claim_not_found":
      return "admin.claims_error_claim_missing";
    case "organisation_linked":
      return "admin.claims_error_organisation_linked";
    case "organisation_inactive":
      return "admin.claims_error_organisation_inactive";
    case "organisation_not_found":
    case "registry_unavailable":
      return "admin.claims_error_organisation_missing";
    case "applicant_linked":
      return "admin.claims_error_applicant_linked";
    case "applicant_ineligible":
      return "admin.claims_error_applicant_ineligible";
    case "no_location":
      return "admin.claims_error_no_location";
    case "reviewer_not_admin":
      return "admin.claims_error_forbidden";
  }
  if (status === 401) return "admin.claims_error_session";
  if (status === 403) return "admin.claims_error_forbidden";
  if (status === 429) return "auth.error_rate_limited";
  if (status === 400) return "admin.claims_error_invalid";
  if (status === 409) return "admin.claims_error_conflict";
  return "admin.claims_error_unavailable";
}

/** What opening a mailbox-challenge link achieved, as far as the visitor needs to know. */
export type ClaimConfirmationOutcome = "confirmed" | "invalid" | "closed" | "unavailable";

export function claimConfirmationOutcome(
  status: number,
  code?: string | null
): ClaimConfirmationOutcome {
  if (status >= 200 && status < 300) return "confirmed";
  if (code === "claim_closed") return "closed";
  // Used, expired, superseded by a newer link, or never valid: the same next
  // step in every case, so they are one outcome.
  if (status === 400 || status === 404 || status === 409) return "invalid";
  return "unavailable";
}

/**
 * Pulls a mailbox-challenge token out of a confirmation link. New links carry
 * it in the fragment (`#claim_token=`) so it never reaches an HTTP request;
 * already-sent ones may carry it in the query. `cleaned` is the address to put
 * back in the bar, without the token.
 */
export function takeClaimToken(href: string): { token: string | null; cleaned: string } {
  const url = new URL(href);
  const token =
    url.searchParams.get("claim_token") ??
    new URLSearchParams(url.hash.slice(1)).get("claim_token");
  if (!token) return { token: null, cleaned: `${url.pathname}${url.search}${url.hash}` };
  url.searchParams.delete("claim_token");
  url.hash = "";
  return { token, cleaned: `${url.pathname}${url.search}` };
}

/**
 * "udruga@gmail.com" -> "u***@gmail.com": enough for the applicant to
 * recognise which mailbox the link went to, without spelling it out.
 */
export function maskEmailAddress(email: string | null | undefined): string | null {
  const value = email?.trim();
  if (!value) return null;
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return null;
  const first = Array.from(value.slice(0, at))[0];
  return `${first}***${value.slice(at)}`;
}

/** Case- and whitespace-insensitive comparison for the reviewer's mismatch warning. */
export function sameEmailAddress(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = a?.trim().toLowerCase();
  const right = b?.trim().toLowerCase();
  return Boolean(left) && left === right;
}

/**
 * approve_institution_claim_transaction refuses a claim whose register mailbox
 * was never confirmed unless the reviewer recorded how they checked the
 * applicant some other way, marked by this prefix on the review note.
 */
export const CLAIM_OUT_OF_BAND_PREFIX = "Provjereno:";

/** Room left for the reviewer's own words once the prefix and its space are added. */
export const CLAIM_OUT_OF_BAND_NOTE_MAX_LENGTH =
  CLAIM_NOTE_MAX_LENGTH - CLAIM_OUT_OF_BAND_PREFIX.length - 1;

/**
 * The note an approval sends. With a confirmed mailbox it is optional and
 * passes through; without one the reviewer describes the check and this adds
 * the prefix (once, even if they typed it themselves). Null means "nothing to
 * send", which for an unconfirmed mailbox the caller must treat as missing.
 */
export function claimApprovalNote(emailVerified: boolean, text: string): string | null {
  const trimmed = text.trim();
  if (emailVerified) return trimmed || null;
  const description = trimmed.replace(/^provjereno:\s*/i, "").trim();
  return description ? `${CLAIM_OUT_OF_BAND_PREFIX} ${description}` : null;
}

/** Where a claim's mailbox challenge stands, for the review queue. */
export type ClaimChallengeState =
  | "verified"
  | "sent"
  | "expired"
  | "not_sent"
  | "no_registry_email";

export function claimChallengeState(
  claim: Pick<
    InstitutionClaimReviewItem,
    "email_verified" | "email_challenge_sent" | "email_challenge_expires_at"
  > & { organisation: { registry_email: string | null } | null },
  now: number
): ClaimChallengeState {
  if (claim.email_verified) return "verified";
  if (claim.email_challenge_sent) {
    const expiresAt = claim.email_challenge_expires_at
      ? Date.parse(claim.email_challenge_expires_at)
      : Number.NaN;
    return Number.isFinite(expiresAt) && expiresAt <= now ? "expired" : "sent";
  }
  return claim.organisation?.registry_email ? "not_sent" : "no_registry_email";
}
