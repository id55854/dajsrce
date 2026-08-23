/**
 * "I am this association" is a reviewed claim against the official Croatian
 * Associations Register, not a free-text assertion. Everything here is shape
 * and bounds only — authorisation lives in the transactional RPCs, which read
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
        registry_number: string | null;
        legal_form: string | null;
        website: string | null;
        already_linked: boolean;
      })
    | null;
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
 * The raw database message is never forwarded — it can name rows the caller
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
