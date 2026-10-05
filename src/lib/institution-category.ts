import { getCategoryConfig } from "./constants";
import { SOCIAL_MAP_CATEGORIES } from "./location-map";
import type { InstitutionCategory } from "./types";

/**
 * How an organisation describes its own type.
 *
 * It picks one of the social categories itself, except the violence-support
 * one: those organisations are never pinned at their seat, so moving into or
 * out of it stays an administrator's decision. When no category fits, it
 * writes its own type, which an administrator approves before it is shown.
 * `update_own_institution_profile`, `request_institution_category_label` and
 * `review_institution_category_request` (20261005100000) enforce the same
 * rules; these copies let the form and the routes answer first.
 */
export const SELF_SERVICE_CATEGORIES: InstitutionCategory[] = SOCIAL_MAP_CATEGORIES.filter(
  (category) => category !== "domestic_violence"
);

/** The editor's "none of these" choice: the organisation types its own. */
export const OWN_CATEGORY = "other" as const;

export const CATEGORY_LABEL_LIMITS = { min: 2, max: 80 } as const;

export const CATEGORY_REVIEW_NOTE_MAX_LENGTH = 1000;

export function isSelfServiceCategory(value: unknown): value is InstitutionCategory {
  return (
    typeof value === "string" &&
    (SELF_SERVICE_CATEGORIES as readonly string[]).includes(value)
  );
}

/** The category an organisation can no longer change by itself. */
export function categoryLockedForOrganisation(category: string): boolean {
  return category === "domestic_violence";
}

/** Trimmed, inner whitespace collapsed; null when outside the limits. */
export function normalizeCategoryLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim().replace(/\s+/g, " ");
  return label.length >= CATEGORY_LABEL_LIMITS.min && label.length <= CATEGORY_LABEL_LIMITS.max
    ? label
    : null;
}

/** What the public profile calls the organisation's type. */
export function institutionTypeLabel(
  institution: { category: string; categoryLabel?: string | null },
  locale: string
): string {
  const own = institution.categoryLabel?.trim();
  if (own) return own;
  const config = getCategoryConfig(institution.category);
  return locale === "hr" ? config.labelHr : config.label;
}

export type CategoryRequestStatus = "pending" | "approved" | "rejected" | "withdrawn";

/** The organisation's latest request, as its dashboard sees it. */
export type InstitutionCategoryRequest = {
  id: string;
  label: string;
  status: CategoryRequestStatus;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

/** One open request in the administrators' queue. */
export type CategoryRequestReviewItem = {
  id: string;
  label: string;
  created_at: string;
  institution: {
    id: string;
    name: string;
    category: string;
    category_label: string | null;
    city: string | null;
  } | null;
};

export type CategoryRequestReviewInput = {
  decision: "approve" | "reject";
  category: InstitutionCategory | null;
  note: string | null;
};

export function parseCategoryRequestReviewInput(
  value: unknown
): { ok: true; value: CategoryRequestReviewInput } | { ok: false; error: string } {
  const body =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!body) return { ok: false, error: "Request body must be an object" };

  const decision = body.decision;
  if (decision !== "approve" && decision !== "reject") {
    return { ok: false, error: "decision must be approve or reject" };
  }

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") return { ok: false, error: "note must be text" };
    note = body.note.trim() || null;
    if (note && note.length > CATEGORY_REVIEW_NOTE_MAX_LENGTH) {
      return { ok: false, error: `note must be at most ${CATEGORY_REVIEW_NOTE_MAX_LENGTH} characters` };
    }
  }

  let category: InstitutionCategory | null = null;
  if (decision === "approve" && body.category !== undefined && body.category !== null && body.category !== "") {
    // The violence-support category hides a location; the transaction
    // refuses to set it from a type request, so the route does too.
    if (!isSelfServiceCategory(body.category)) {
      return { ok: false, error: "category must be one of the social categories" };
    }
    category = body.category;
  }

  return { ok: true, value: { decision, category, note } };
}

/** HTTP status for a database error from the category functions. */
export function categoryRequestErrorStatus(code: string | null | undefined): number {
  switch (code) {
    case "42501":
      return 403;
    case "P0002":
      return 404;
    case "22023":
      return 400;
    case "P0001":
      return 409;
    default:
      return 500;
  }
}
