import { DONATION_TYPES } from "./constants";
import { parseISODate } from "./dates";
import type { DonationType, UrgencyLevel } from "./types";

/**
 * Rules for an organisation writing its own needs: what a new need may be
 * about, what an edit may change, and how a refusal reads in the form.
 *
 * `update_need_transaction` is the only edit path (direct UPDATE on `needs`
 * is revoked) and decides ownership itself. This copy validates the patch so
 * the form can point at the field and the route can refuse a malformed body
 * before it costs a transaction.
 */
export const NEED_PATCH_FIELDS = [
  "title",
  "description",
  "urgency",
  "quantity_needed",
  "deadline",
  "is_fulfilled",
] as const;

export type NeedPatchField = (typeof NEED_PATCH_FIELDS)[number];

/** Fields a need write can be refused for, create and edit together. */
export type NeedField = NeedPatchField | "donation_type";

export type NeedPatch = {
  title?: string;
  description?: string | null;
  urgency?: UrgencyLevel;
  quantity_needed?: number | null;
  deadline?: string | null;
  is_fulfilled?: boolean;
};

export const NEED_LIMITS = {
  title: 160,
  description: 4000,
  quantityMax: 1_000_000,
} as const;

const URGENCIES: readonly UrgencyLevel[] = ["routine", "needed_soon", "urgent"];

/**
 * Donation types a new need may be published for.
 *
 * Money is left out for launch. Under the Humanitarian Aid Act (Zakon o
 * humanitarnoj pomoći, NN 156/23) collecting money for people in need takes
 * permanent-collector status or an approved humanitarian action, and DajSrce
 * does not check either yet. Needs already published for money still show.
 */
export const NEW_NEED_DONATION_TYPES = (Object.keys(DONATION_TYPES) as DonationType[]).filter(
  (type) => type !== "money"
);

export function isOpenForNewNeeds(type: string): boolean {
  return (NEW_NEED_DONATION_TYPES as readonly string[]).includes(type);
}

type PatchResult =
  | { ok: true; value: NeedPatch }
  | { ok: false; error: string; field: NeedField | null };

type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string; field: NeedField };

function fail(field: NeedField, error: string): { ok: false; error: string; field: NeedField } {
  return { ok: false, error, field };
}

function title(value: unknown): FieldResult<string> {
  if (typeof value !== "string") return fail("title", "title must be text");
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > NEED_LIMITS.title) {
    return fail("title", `title must contain 1-${NEED_LIMITS.title} characters`);
  }
  return { ok: true, value: trimmed };
}

function description(value: unknown): FieldResult<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return fail("description", "description must be text");
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > NEED_LIMITS.description) {
    return fail("description", `description must contain 1-${NEED_LIMITS.description} characters`);
  }
  return { ok: true, value: trimmed };
}

function quantity(value: unknown): FieldResult<number | null> {
  if (value === null || value === "") return { ok: true, value: null };
  const parsed =
    typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > NEED_LIMITS.quantityMax) {
    return fail("quantity_needed", `quantity_needed must be an integer between 1 and ${NEED_LIMITS.quantityMax}`);
  }
  return { ok: true, value: parsed };
}

function deadline(value: unknown): FieldResult<string | null> {
  if (value === null || value === "") return { ok: true, value: null };
  const parsed = parseISODate(value);
  return parsed ? { ok: true, value: parsed } : fail("deadline", "deadline must be a real YYYY-MM-DD date");
}

function parseField(field: NeedPatchField, raw: unknown): FieldResult<unknown> {
  switch (field) {
    case "title":
      return title(raw);
    case "description":
      return description(raw);
    case "urgency":
      return typeof raw === "string" && (URGENCIES as readonly string[]).includes(raw)
        ? { ok: true, value: raw }
        : fail("urgency", "urgency is invalid");
    case "quantity_needed":
      return quantity(raw);
    case "deadline":
      return deadline(raw);
    case "is_fulfilled":
      return typeof raw === "boolean"
        ? { ok: true, value: raw }
        : fail("is_fulfilled", "is_fulfilled must be true or false");
  }
}

/**
 * Validate an edit of one need. Only the keys present change. The donation
 * type is fixed once published: pledges were made for that kind of help, so a
 * different kind is a new need.
 */
export function parseNeedPatch(value: unknown): PatchResult {
  const body =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!body) return { ok: false, error: "Request body must be an object", field: null };
  const keys = Object.keys(body);
  if (keys.length === 0) return { ok: false, error: "Nothing to update", field: null };

  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === "donation_type") {
      return fail("donation_type", "donation_type cannot be changed; post a new need instead");
    }
    if (!(NEED_PATCH_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: `${key} cannot be changed`, field: null };
    }
    const result = parseField(key as NeedPatchField, body[key]);
    if (!result.ok) return result;
    patch[key] = result.value;
  }
  return { ok: true, value: patch as NeedPatch };
}

const NEED_FIELDS: readonly NeedField[] = [...NEED_PATCH_FIELDS, "donation_type"];

/**
 * The field a validation message is about. Both the create parser and the
 * database name the field in their messages; the messages stay internal.
 */
export function needFieldFromMessage(message: string | null | undefined): NeedField | null {
  if (!message) return null;
  return (
    NEED_FIELDS.find((field) => new RegExp(`(^|[^a-z_])${field}([^a-z_]|$)`, "i").test(message)) ??
    null
  );
}

export function isNeedField(value: unknown): value is NeedField {
  return typeof value === "string" && (NEED_FIELDS as readonly string[]).includes(value);
}

const FIELD_ERROR_KEYS: Record<NeedField, string> = {
  title: "institution.need_error_title",
  description: "institution.need_error_description",
  urgency: "institution.need_error_invalid",
  quantity_needed: "institution.need_error_quantity",
  deadline: "institution.need_error_deadline",
  is_fulfilled: "institution.need_error_invalid",
  donation_type: "institution.need_error_donation_type",
};

/**
 * Translation key for a refused create or edit. The API's `error` string is
 * internal English; the status, a stable `code` and the `field` are what the
 * form turns into Croatian.
 */
export function needErrorKey(
  { status, code, field }: { status: number; code?: string | null; field?: string | null },
  mode: "create" | "update"
): string {
  if (code === "donation_type_unavailable") return "institution.need_error_money";
  if (code === "quantity_below_pledged") return "institution.need_error_below_pledged";
  if (status === 400) {
    return isNeedField(field) ? FIELD_ERROR_KEYS[field] : "institution.need_error_invalid";
  }
  if (status === 401) return "institution.need_error_signed_out";
  if (status === 403) return "institution.need_error_forbidden";
  if (status === 404) return "institution.need_error_not_found";
  if (status === 429) return "auth.error_rate_limited";
  return mode === "create" ? "institution.dashboard_error_need_failed" : "institution.need_update_failed";
}
