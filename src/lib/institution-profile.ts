import { DONATION_TYPES } from "./constants";
import type { PublicInstitutionDetail } from "./location-map";
import type { DonationType } from "./types";

/**
 * What an organisation may change about its own public profile, and how.
 *
 * `update_own_institution_profile` enforces the same rules in the database and
 * is the only edit path (direct UPDATE on `institutions` is revoked). This
 * copy exists so the form can say what is wrong next to the field, and so the
 * route refuses a malformed patch before it costs a transaction. Name,
 * category, address and coordinates are absent on purpose: they come from the
 * official register and the reviewed claim, never from a typed value.
 */
export const INSTITUTION_PROFILE_FIELDS = [
  "description",
  "phone",
  "email",
  "website",
  "working_hours",
  "drop_off_hours",
  "accepts_donations",
] as const;

export type InstitutionProfileField = (typeof INSTITUTION_PROFILE_FIELDS)[number];

export type InstitutionProfilePatch = {
  description?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  working_hours?: string | null;
  drop_off_hours?: string | null;
  accepts_donations?: DonationType[];
};

export const PROFILE_LIMITS = {
  description: 2000,
  phoneMin: 6,
  phoneMax: 40,
  email: 254,
  website: 300,
  hours: 300,
} as const;

type TextField = Exclude<InstitutionProfileField, "accepts_donations">;

type PatchResult =
  | { ok: true; value: InstitutionProfilePatch }
  | { ok: false; error: string; field: InstitutionProfileField | null };

type FieldResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; field: InstitutionProfileField };

const DONATION_KEYS = Object.keys(DONATION_TYPES) as DonationType[];
const PHONE_CHARACTERS = /^[0-9 +()/.-]+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function isInstitutionProfileField(value: unknown): value is InstitutionProfileField {
  return (
    typeof value === "string" &&
    (INSTITUTION_PROFILE_FIELDS as readonly string[]).includes(value)
  );
}

function fail(field: InstitutionProfileField, error: string): { ok: false; error: string; field: InstitutionProfileField } {
  return { ok: false, error, field };
}

/** Trimmed text, or null when left empty; every text field may be cleared. */
function optionalText(
  value: unknown,
  field: TextField,
  maximum: number
): FieldResult<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return fail(field, `${field} must be text`);
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > maximum) {
    return fail(field, `${field} must be at most ${maximum} characters`);
  }
  return { ok: true, value: trimmed };
}

/**
 * A website as the organisation would type it, made into an http(s) URL.
 *
 * People write "www.udruga.hr", and the register often stores it that way
 * too, so a bare host gets `https://`. Anything that is not http(s), has no
 * dotted host or carries credentials is refused rather than linked.
 */
export function normalizeWebsite(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const candidate = URL_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (candidate.length > PROFILE_LIMITS.website) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname.includes(".") || url.username || url.password) return null;
  return candidate;
}

function phone(value: unknown): FieldResult<string | null> {
  const text = optionalText(value, "phone", PROFILE_LIMITS.phoneMax);
  if (!text.ok || text.value === null) return text;
  const digits = text.value.replace(/\D/g, "").length;
  if (
    text.value.length < PROFILE_LIMITS.phoneMin ||
    !PHONE_CHARACTERS.test(text.value) ||
    digits < PROFILE_LIMITS.phoneMin
  ) {
    return fail("phone", "phone must be 6-40 characters of digits, spaces and + ( ) / - .");
  }
  return text;
}

function email(value: unknown): FieldResult<string | null> {
  const text = optionalText(value, "email", PROFILE_LIMITS.email);
  if (!text.ok || text.value === null) return text;
  return EMAIL.test(text.value) ? text : fail("email", "email is invalid");
}

function website(value: unknown): FieldResult<string | null> {
  const text = optionalText(value, "website", PROFILE_LIMITS.website);
  if (!text.ok || text.value === null) return text;
  const normalized = normalizeWebsite(text.value);
  return normalized ? { ok: true, value: normalized } : fail("website", "website must be an http(s) address");
}

function donationTypes(value: unknown): FieldResult<DonationType[]> {
  if (!Array.isArray(value)) return fail("accepts_donations", "accepts_donations must be a list");
  const chosen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !Object.hasOwn(DONATION_TYPES, item)) {
      return fail("accepts_donations", "accepts_donations contains an unknown donation type");
    }
    chosen.add(item);
  }
  // Stored in the one canonical order, so the same choice is the same value.
  return { ok: true, value: DONATION_KEYS.filter((key) => chosen.has(key)) };
}

function parseField(
  field: InstitutionProfileField,
  raw: unknown
): FieldResult<string | null> | FieldResult<DonationType[]> {
  switch (field) {
    case "description":
      return optionalText(raw, "description", PROFILE_LIMITS.description);
    case "phone":
      return phone(raw);
    case "email":
      return email(raw);
    case "website":
      return website(raw);
    case "working_hours":
    case "drop_off_hours":
      return optionalText(raw, field, PROFILE_LIMITS.hours);
    case "accepts_donations":
      return donationTypes(raw);
  }
}

/**
 * Validate a partial profile update. Only the keys present are changed; an
 * unknown key (including `name` or `category`) refuses the whole patch.
 */
export function parseInstitutionProfilePatch(value: unknown): PatchResult {
  const body =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!body) return { ok: false, error: "Request body must be an object", field: null };
  const keys = Object.keys(body);
  if (keys.length === 0) return { ok: false, error: "Nothing to update", field: null };

  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    if (!isInstitutionProfileField(key)) {
      return { ok: false, error: `${key} cannot be changed here`, field: null };
    }
    const result = parseField(key, body[key]);
    if (!result.ok) return result;
    patch[key] = result.value;
  }
  return { ok: true, value: patch as InstitutionProfilePatch };
}

/**
 * The field a database validation error (22023) is about. The RPC names the
 * field in its message; the message itself never leaves the server.
 */
export function profileFieldFromMessage(
  message: string | null | undefined
): InstitutionProfileField | null {
  if (!message) return null;
  return (
    INSTITUTION_PROFILE_FIELDS.find((field) =>
      new RegExp(`(^|[^a-z_])${field}([^a-z_]|$)`, "i").test(message)
    ) ?? null
  );
}

/** Translation key for a failed save; field errors sit next to their field. */
export function institutionProfileErrorKey(
  status: number,
  field: InstitutionProfileField | null
): string {
  if (status === 400) {
    return field ? `institution_profile.error_${field}` : "institution_profile.error_invalid";
  }
  if (status === 401) return "institution_profile.error_signed_out";
  if (status === 403) return "institution_profile.error_forbidden";
  if (status === 404) return "institution_profile.error_not_found";
  if (status === 429) return "auth.error_rate_limited";
  return "institution_profile.error_generic";
}

/** The form's working copy: plain strings, so an empty field is "". */
export type InstitutionProfileDraft = {
  description: string;
  phone: string;
  email: string;
  website: string;
  working_hours: string;
  drop_off_hours: string;
  accepts_donations: DonationType[];
};

type ProfileSource = Pick<
  PublicInstitutionDetail,
  "description" | "phone" | "email" | "website" | "workingHours" | "dropOffHours" | "acceptsDonations"
>;

export function profileDraftFrom(detail: ProfileSource): InstitutionProfileDraft {
  return {
    description: detail.description ?? "",
    phone: detail.phone ?? "",
    email: detail.email ?? "",
    website: detail.website ?? "",
    working_hours: detail.workingHours ?? "",
    drop_off_hours: detail.dropOffHours ?? "",
    accepts_donations: DONATION_KEYS.filter((key) => detail.acceptsDonations.includes(key)),
  };
}

/**
 * Only what the organisation actually changed. Sending an untouched donation
 * list would mark a register guess as the organisation's own confirmation.
 */
export function changedProfileFields(
  initial: InstitutionProfileDraft,
  draft: InstitutionProfileDraft
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of INSTITUTION_PROFILE_FIELDS) {
    if (field === "accepts_donations") {
      const before = [...initial.accepts_donations].sort().join(",");
      const after = [...draft.accepts_donations].sort().join(",");
      if (before !== after) patch.accepts_donations = draft.accepts_donations;
      continue;
    }
    if (draft[field].trim() !== initial[field].trim()) patch[field] = draft[field];
  }
  return patch;
}

/** What `update_own_institution_profile` returns. */
export type InstitutionProfileResult = {
  id: string;
  name: string;
  description: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  working_hours: string | null;
  drop_off_hours: string | null;
  accepts_donations: string[] | null;
  donation_acceptance_confirmed?: boolean | null;
  updated_at: string;
};

/** Fold a saved profile back into the dashboard's copy of the public detail. */
export function applyProfileResult(
  detail: PublicInstitutionDetail,
  result: InstitutionProfileResult
): PublicInstitutionDetail {
  return {
    ...detail,
    description: result.description ?? "",
    phone: result.phone,
    email: result.email,
    website: result.website,
    workingHours: result.working_hours,
    dropOffHours: result.drop_off_hours,
    acceptsDonations: DONATION_KEYS.filter((key) => (result.accepts_donations ?? []).includes(key)),
    updatedAt: result.updated_at ?? detail.updatedAt,
  };
}

export type ProfileEssential = "phone" | "drop_off_hours" | "accepts_donations";

/**
 * What a donor cannot do without: a number to call, when and where to bring
 * things, and what is accepted at all. The dashboard asks for these first.
 */
export function missingProfileEssentials(
  detail: Pick<PublicInstitutionDetail, "phone" | "dropOffHours" | "acceptsDonations">
): ProfileEssential[] {
  const missing: ProfileEssential[] = [];
  if (!detail.phone?.trim()) missing.push("phone");
  if (!detail.dropOffHours?.trim()) missing.push("drop_off_hours");
  if (detail.acceptsDonations.length === 0) missing.push("accepts_donations");
  return missing;
}
