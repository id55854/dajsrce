import { DONATION_TYPES } from "@/lib/constants";
import type { DonationType } from "@/lib/types";

/**
 * Citizen donation offers — the reverse of the need/pledge flow. A private
 * individual publishes what they can give; a verified organisation asks for it.
 *
 * Two rules are enforced here as well as in the database, because a projection
 * bug in either layer would leak a private person's home or contact details:
 *
 *   1. An offer never carries an exact coordinate or a street address. The
 *      only location fields that exist are `city` and a coarse, grid-snapped
 *      point produced server-side.
 *   2. Contact details belong to an accepted claim, never to a listing. The
 *      browse projection has no field that could hold one.
 *
 * Every projection below is an explicit allow-list rather than a spread of the
 * RPC payload, so a new database column cannot reach the browser by accident.
 */

export const OFFERS_API_VERSION = 1 as const;

export const OFFER_LIST_LIMIT = 30;
export const OFFER_LIST_LIMIT_MAX = 60;
export const OFFER_LIST_OFFSET_MAX = 5000;

export const OFFER_TITLE_MIN_LENGTH = 3;
export const OFFER_TITLE_MAX_LENGTH = 120;
export const OFFER_DESCRIPTION_MAX_LENGTH = 2000;
export const OFFER_UNIT_MAX_LENGTH = 32;
export const OFFER_CITY_MIN_LENGTH = 2;
export const OFFER_CITY_MAX_LENGTH = 120;
export const OFFER_QUANTITY_MIN = 1;
export const OFFER_QUANTITY_MAX = 100_000;
export const OFFER_CLAIM_MESSAGE_MAX_LENGTH = 1000;
export const OFFER_QUERY_MIN_LENGTH = 2;
export const OFFER_QUERY_MAX_LENGTH = 80;
export const OFFER_AVAILABILITY_MAX_DAYS = 365;

export const OFFER_STATUSES = [
  "open",
  "claimed",
  "withdrawn",
  "fulfilled",
  "expired",
] as const;

export const OFFER_CLAIM_STATUSES = [
  "requested",
  "accepted",
  "declined",
  "withdrawn",
] as const;

export const OFFER_LIST_SCOPES = ["open", "mine", "inbox"] as const;

/** Statuses an author may set directly. Everything else is server-derived. */
export const OFFER_AUTHOR_STATUS_TRANSITIONS = ["withdrawn", "fulfilled"] as const;

/**
 * Terminal transitions a claim can be pushed into from the API. `accepted` and
 * `declined` belong to the offer's author; `withdrawn` belongs to the
 * requesting organisation. Which one the caller is allowed to take is decided
 * inside the transaction, not here.
 */
export const OFFER_CLAIM_DECISIONS = ["accepted", "declined", "withdrawn"] as const;

export type OfferStatus = (typeof OFFER_STATUSES)[number];
export type OfferClaimStatus = (typeof OFFER_CLAIM_STATUSES)[number];
export type OfferListScope = (typeof OFFER_LIST_SCOPES)[number];
export type OfferAuthorStatusTransition =
  (typeof OFFER_AUTHOR_STATUS_TRANSITIONS)[number];
export type OfferClaimDecision = (typeof OFFER_CLAIM_DECISIONS)[number];

const DONATION_TYPE_VALUES = new Set(Object.keys(DONATION_TYPES));
const OFFER_STATUS_VALUES = new Set<string>(OFFER_STATUSES);
const OFFER_CLAIM_STATUS_VALUES = new Set<string>(OFFER_CLAIM_STATUSES);

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/**
 * What a verified organisation sees while browsing. Deliberately has no
 * `user_id`, no contact fields, no address and no exact coordinate — the
 * coarse point is the finest location that exists anywhere in this type.
 */
export type PublicOffer = {
  id: string;
  title: string;
  description: string;
  donation_type: DonationType;
  quantity: number;
  unit: string | null;
  city: string;
  coarse_lat: number | null;
  coarse_lng: number | null;
  available_until: string | null;
  status: OfferStatus;
  created_at: string;
};

export type OfferBrowseItem = PublicOffer & {
  /** True when the caller's own organisation already has a live claim. */
  claimed_by_us: boolean;
};

export type OfferContact = {
  email: string | null;
  phone: string | null;
  website: string | null;
};

/** A claim as its offer's author sees it. */
export type AuthorOfferClaim = {
  id: string;
  institution_id: string;
  institution_name: string;
  institution_city: string | null;
  status: OfferClaimStatus;
  message: string | null;
  created_at: string;
  responded_at: string | null;
  /** Non-null only once this author has accepted the claim. */
  contact: OfferContact | null;
};

export type AuthorOffer = PublicOffer & {
  claimed_institution_id: string | null;
  updated_at: string;
  claims: AuthorOfferClaim[];
};

export type OfferDonorContact = {
  name: string | null;
  email: string | null;
  contact_person: string | null;
};

/** A claim as the requesting organisation sees it. */
export type InstitutionOfferClaim = {
  id: string;
  status: OfferClaimStatus;
  message: string | null;
  created_at: string;
  responded_at: string | null;
  offer: PublicOffer;
  /** Non-null only once the author has accepted this claim. */
  donor: OfferDonorContact | null;
};

export type OfferListMeta = {
  total: number;
  limit: number;
  offset: number;
};

export type OfferListResponse<TItem> = {
  version: typeof OFFERS_API_VERSION;
  scope: OfferListScope;
  items: TItem[];
  meta: OfferListMeta;
};

export type OfferListQuery = {
  scope: OfferListScope;
  donationType: DonationType | null;
  city: string | null;
  query: string | null;
  limit: number;
  offset: number;
};

export type OfferCreateInput = {
  title: string;
  description: string;
  donationType: DonationType;
  quantity: number;
  unit: string | null;
  city: string;
  /** Optional and always coarsened server-side before it is stored. */
  latitude: number | null;
  longitude: number | null;
  availableUntil: string | null;
};

export type OfferUpdateInput =
  | { kind: "status"; status: OfferAuthorStatusTransition }
  | {
      kind: "fields";
      title: string | null;
      description: string | null;
      quantity: number | null;
      unit: string | null;
      availableUntil: string | null;
      clearAvailableUntil: boolean;
    };

export type OfferClaimInput = { message: string | null };

export type OfferClaimDecisionInput = { decision: OfferClaimDecision };

export class OfferValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid offer request: ${issues.join("; ")}`);
    this.name = "OfferValidationError";
  }
}

// ---------------------------------------------------------------------------
// Primitive readers
// ---------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boundedText(
  value: unknown,
  field: string,
  min: number,
  max: number,
  issues: string[]
): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    issues.push(`${field} must be a string`);
    return null;
  }
  // Bound the raw input before trimming so a megabyte of whitespace is still
  // rejected rather than silently collapsing to a valid short string.
  if (value.length > max * 4) {
    issues.push(`${field} must be at most ${max} characters`);
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    issues.push(`${field} must contain ${min} to ${max} characters`);
    return null;
  }
  return trimmed;
}

function boundedInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
  issues: string[]
): number | null {
  if (value == null) return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) {
    issues.push(`${field} must be an integer`);
    return null;
  }
  if (parsed < min || parsed > max) {
    issues.push(`${field} must be between ${min} and ${max}`);
    return null;
  }
  return parsed;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts a calendar date inside the allowed availability window. */
export function parseAvailabilityDate(
  value: unknown,
  field: string,
  issues: string[],
  today = new Date()
): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    issues.push(`${field} must be a YYYY-MM-DD date`);
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    issues.push(`${field} is not a real date`);
    return null;
  }
  const startOfToday = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  const days = Math.round((parsed.getTime() - startOfToday) / 86_400_000);
  if (days < 0) {
    issues.push(`${field} must not be in the past`);
    return null;
  }
  if (days > OFFER_AVAILABILITY_MAX_DAYS) {
    issues.push(`${field} must be within ${OFFER_AVAILABILITY_MAX_DAYS} days`);
    return null;
  }
  return value;
}

function donationType(
  value: unknown,
  issues: string[],
  required: boolean
): DonationType | null {
  if (value == null || value === "") {
    if (required) issues.push("donation_type is required");
    return null;
  }
  if (typeof value !== "string" || value.length > 64 || !DONATION_TYPE_VALUES.has(value)) {
    issues.push("donation_type is not supported");
    return null;
  }
  return value as DonationType;
}

// ---------------------------------------------------------------------------
// Request validators
// ---------------------------------------------------------------------------

export function parseOfferListQuery(params: URLSearchParams): OfferListQuery {
  const issues: string[] = [];

  const rawScope = params.get("scope") ?? "open";
  const scope = (OFFER_LIST_SCOPES as readonly string[]).includes(rawScope)
    ? (rawScope as OfferListScope)
    : "open";
  if (scope !== rawScope) issues.push("scope is not supported");

  const rawType = params.get("donationType");
  const type = rawType == null || rawType === "" ? null : donationType(rawType, issues, false);

  const rawCity = params.get("city");
  const city =
    rawCity == null || rawCity.trim() === ""
      ? null
      : boundedText(rawCity, "city", OFFER_CITY_MIN_LENGTH, OFFER_CITY_MAX_LENGTH, issues);

  const rawQuery = params.get("q");
  const query =
    rawQuery == null || rawQuery.trim() === ""
      ? null
      : boundedText(rawQuery, "q", OFFER_QUERY_MIN_LENGTH, OFFER_QUERY_MAX_LENGTH, issues);

  const limit =
    boundedInteger(params.get("limit"), "limit", 1, OFFER_LIST_LIMIT_MAX, issues) ??
    OFFER_LIST_LIMIT;
  const offset =
    boundedInteger(params.get("offset"), "offset", 0, OFFER_LIST_OFFSET_MAX, issues) ?? 0;

  if (issues.length > 0) throw new OfferValidationError(issues);
  return { scope, donationType: type, city, query, limit, offset };
}

export function parseOfferCreateInput(body: unknown): OfferCreateInput {
  const issues: string[] = [];
  const input = record(body);

  const title = boundedText(
    input.title,
    "title",
    OFFER_TITLE_MIN_LENGTH,
    OFFER_TITLE_MAX_LENGTH,
    issues
  );
  if (title == null && input.title == null) issues.push("title is required");

  const description =
    input.description == null || input.description === ""
      ? ""
      : boundedText(input.description, "description", 0, OFFER_DESCRIPTION_MAX_LENGTH, issues) ?? "";

  const type = donationType(input.donation_type, issues, true);

  const quantity =
    boundedInteger(
      input.quantity ?? OFFER_QUANTITY_MIN,
      "quantity",
      OFFER_QUANTITY_MIN,
      OFFER_QUANTITY_MAX,
      issues
    ) ?? OFFER_QUANTITY_MIN;

  const unit =
    input.unit == null || input.unit === ""
      ? null
      : boundedText(input.unit, "unit", 1, OFFER_UNIT_MAX_LENGTH, issues);

  const city = boundedText(
    input.city,
    "city",
    OFFER_CITY_MIN_LENGTH,
    OFFER_CITY_MAX_LENGTH,
    issues
  );
  if (city == null && input.city == null) issues.push("city is required");

  // The point is optional and is coarsened server-side. It is validated only
  // so that a nonsense pair cannot reach the projection function.
  const latitude = nullableNumber(input.latitude);
  const longitude = nullableNumber(input.longitude);
  if (input.latitude != null && latitude == null) issues.push("latitude must be a number");
  if (input.longitude != null && longitude == null) issues.push("longitude must be a number");
  if (latitude != null && (latitude < -90 || latitude > 90)) {
    issues.push("latitude is out of range");
  }
  if (longitude != null && (longitude < -180 || longitude > 180)) {
    issues.push("longitude is out of range");
  }
  if ((latitude == null) !== (longitude == null)) {
    issues.push("latitude and longitude must be supplied together");
  }

  const availableUntil = parseAvailabilityDate(
    input.available_until,
    "available_until",
    issues
  );

  if (issues.length > 0) throw new OfferValidationError(issues);
  return {
    title: title as string,
    description,
    donationType: type as DonationType,
    quantity,
    unit,
    city: city as string,
    latitude: longitude == null ? null : latitude,
    longitude: latitude == null ? null : longitude,
    availableUntil,
  };
}

export function parseOfferUpdateInput(body: unknown): OfferUpdateInput {
  const issues: string[] = [];
  const input = record(body);

  if (input.status != null) {
    const status = input.status;
    if (
      typeof status !== "string" ||
      !(OFFER_AUTHOR_STATUS_TRANSITIONS as readonly string[]).includes(status)
    ) {
      issues.push("status must be withdrawn or fulfilled");
      throw new OfferValidationError(issues);
    }
    // A status change and a field edit are different intents; refusing the mix
    // keeps the route from silently dropping half of what was sent.
    for (const field of ["title", "description", "quantity", "unit", "available_until"]) {
      if (input[field] !== undefined) {
        issues.push("status cannot be combined with field edits");
        break;
      }
    }
    if (issues.length > 0) throw new OfferValidationError(issues);
    return { kind: "status", status: status as OfferAuthorStatusTransition };
  }

  const title =
    input.title === undefined
      ? null
      : boundedText(input.title, "title", OFFER_TITLE_MIN_LENGTH, OFFER_TITLE_MAX_LENGTH, issues);
  const description =
    input.description === undefined
      ? null
      : boundedText(input.description, "description", 0, OFFER_DESCRIPTION_MAX_LENGTH, issues) ?? "";
  const quantity =
    input.quantity === undefined
      ? null
      : boundedInteger(
          input.quantity,
          "quantity",
          OFFER_QUANTITY_MIN,
          OFFER_QUANTITY_MAX,
          issues
        );
  const unit =
    input.unit === undefined
      ? null
      : input.unit === null || input.unit === ""
        ? ""
        : boundedText(input.unit, "unit", 1, OFFER_UNIT_MAX_LENGTH, issues);

  const clearAvailableUntil = input.available_until === null;
  const availableUntil = clearAvailableUntil
    ? null
    : parseAvailabilityDate(input.available_until, "available_until", issues);

  const touched =
    title != null ||
    description != null ||
    quantity != null ||
    unit != null ||
    availableUntil != null ||
    clearAvailableUntil;
  if (!touched) issues.push("no supported field was supplied");

  if (issues.length > 0) throw new OfferValidationError(issues);
  return {
    kind: "fields",
    title,
    description,
    quantity,
    unit,
    availableUntil,
    clearAvailableUntil,
  };
}

export function parseOfferClaimInput(body: unknown): OfferClaimInput {
  const issues: string[] = [];
  const input = record(body);
  const message =
    input.message == null || input.message === ""
      ? null
      : boundedText(input.message, "message", 1, OFFER_CLAIM_MESSAGE_MAX_LENGTH, issues);
  if (issues.length > 0) throw new OfferValidationError(issues);
  return { message };
}

export function parseOfferClaimDecisionInput(body: unknown): OfferClaimDecisionInput {
  const issues: string[] = [];
  const input = record(body);
  const decision = input.decision;
  if (
    typeof decision !== "string" ||
    !(OFFER_CLAIM_DECISIONS as readonly string[]).includes(decision)
  ) {
    issues.push("decision must be accepted, declined or withdrawn");
  }
  if (issues.length > 0) throw new OfferValidationError(issues);
  return { decision: decision as OfferClaimDecision };
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOfferIdentifier(value: string): boolean {
  return UUID.test(value);
}

// ---------------------------------------------------------------------------
// Response projections — explicit allow-lists, never a spread of the RPC row.
// ---------------------------------------------------------------------------

function offerStatus(value: unknown): OfferStatus {
  return typeof value === "string" && OFFER_STATUS_VALUES.has(value)
    ? (value as OfferStatus)
    : "open";
}

function claimStatus(value: unknown): OfferClaimStatus {
  return typeof value === "string" && OFFER_CLAIM_STATUS_VALUES.has(value)
    ? (value as OfferClaimStatus)
    : "requested";
}

export function toPublicOffer(row: unknown): PublicOffer {
  const source = record(row);
  return {
    id: String(source.id ?? ""),
    title: String(source.title ?? ""),
    description: String(source.description ?? ""),
    donation_type: (donationTypeOrFallback(source.donation_type)),
    quantity: nullableNumber(source.quantity) ?? 0,
    unit: nullableString(source.unit),
    city: String(source.city ?? ""),
    coarse_lat: nullableNumber(source.coarse_lat),
    coarse_lng: nullableNumber(source.coarse_lng),
    available_until: nullableString(source.available_until),
    status: offerStatus(source.status),
    created_at: String(source.created_at ?? ""),
  };
}

function donationTypeOrFallback(value: unknown): DonationType {
  return typeof value === "string" && DONATION_TYPE_VALUES.has(value)
    ? (value as DonationType)
    : "clothes";
}

export function toOfferBrowseItem(row: unknown): OfferBrowseItem {
  const source = record(row);
  return { ...toPublicOffer(row), claimed_by_us: source.claimed_by_us === true };
}

function toOfferContact(row: unknown): OfferContact | null {
  if (row == null) return null;
  const source = record(row);
  return {
    email: nullableString(source.email),
    phone: nullableString(source.phone),
    website: nullableString(source.website),
  };
}

export function toAuthorOfferClaim(row: unknown): AuthorOfferClaim {
  const source = record(row);
  const status = claimStatus(source.status);
  return {
    id: String(source.id ?? ""),
    institution_id: String(source.institution_id ?? ""),
    institution_name: String(source.institution_name ?? ""),
    institution_city: nullableString(source.institution_city),
    status,
    message: nullableString(source.message),
    created_at: String(source.created_at ?? ""),
    responded_at: nullableString(source.responded_at),
    // Belt and braces: even if a future RPC change attached a contact to a
    // pending claim, the API would not forward it.
    contact: status === "accepted" ? toOfferContact(source.contact) : null,
  };
}

export function toAuthorOffer(row: unknown): AuthorOffer {
  const source = record(row);
  const claims = Array.isArray(source.claims) ? source.claims : [];
  return {
    ...toPublicOffer(row),
    claimed_institution_id: nullableString(source.claimed_institution_id),
    updated_at: String(source.updated_at ?? ""),
    claims: claims.map(toAuthorOfferClaim),
  };
}

export function toInstitutionOfferClaim(row: unknown): InstitutionOfferClaim {
  const source = record(row);
  const status = claimStatus(source.status);
  const donor = record(source.donor);
  return {
    id: String(source.id ?? ""),
    status,
    message: nullableString(source.message),
    created_at: String(source.created_at ?? ""),
    responded_at: nullableString(source.responded_at),
    offer: toPublicOffer(source.offer),
    donor:
      status === "accepted" && source.donor != null
        ? {
            name: nullableString(donor.name),
            email: nullableString(donor.email),
            contact_person: nullableString(donor.contact_person),
          }
        : null,
  };
}

export function toOfferListMeta(row: unknown, fallbackLimit: number): OfferListMeta {
  const source = record(row);
  return {
    total: nullableNumber(source.total) ?? 0,
    limit: nullableNumber(source.limit) ?? fallbackLimit,
    offset: nullableNumber(source.offset) ?? 0,
  };
}

export function offerListItems(payload: unknown): unknown[] {
  const source = record(payload);
  return Array.isArray(source.items) ? source.items : [];
}

// ---------------------------------------------------------------------------
// Error mapping — one stable HTTP status per database error class.
// ---------------------------------------------------------------------------

export function offerErrorStatus(code: string | null | undefined): number {
  switch (code) {
    case "42501":
      return 403;
    case "P0002":
      return 404;
    case "22023":
      return 400;
    case "23503":
      return 409;
    case "23505":
      return 409;
    case "23514":
      return 409;
    default:
      return 500;
  }
}

export function offerRpcArgs(input: OfferCreateInput, actorId: string) {
  return {
    p_actor_id: actorId,
    p_title: input.title,
    p_description: input.description,
    p_donation_type: input.donationType,
    p_quantity: input.quantity,
    p_unit: input.unit,
    p_city: input.city,
    p_latitude: input.latitude,
    p_longitude: input.longitude,
    p_available_until: input.availableUntil,
  };
}
