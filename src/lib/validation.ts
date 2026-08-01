import { DONATION_TYPES } from "./constants";
import { parseISODate } from "./dates";

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  optional = false
): ValidationResult<string | null> {
  if ((value === null || value === undefined || value === "") && optional) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") return { ok: false, error: `${field} must be text` };
  const normalized = value.trim();
  if (normalized.length === 0 && optional) {
    return { ok: true, value: null };
  }
  if (normalized.length < minimum || normalized.length > maximum) {
    return { ok: false, error: `${field} must contain ${minimum}-${maximum} characters` };
  }
  return { ok: true, value: normalized };
}

function integer(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  optional = false
): ValidationResult<number | null> {
  if ((value === null || value === undefined || value === "") && optional) {
    return { ok: true, value: null };
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return { ok: false, error: `${field} must be an integer between ${minimum} and ${maximum}` };
  }
  return { ok: true, value: parsed };
}

export function parseBoundedLimit(
  value: string | null,
  fallback: number,
  maximum: number
): ValidationResult<number> {
  if (value === null || value === "") return { ok: true, value: fallback };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    return { ok: false, error: `limit must be an integer between 1 and ${maximum}` };
  }
  return { ok: true, value: parsed };
}

export type NeedInput = {
  title: string;
  description: string | null;
  donation_type: string;
  urgency: "routine" | "needed_soon" | "urgent";
  quantity_needed: number | null;
};

export function parseNeedInput(value: unknown): ValidationResult<NeedInput> {
  const body = recordOf(value);
  if (!body) return { ok: false, error: "Request body must be an object" };
  const title = text(body.title, "title", 1, 160);
  if (!title.ok) return title;
  const description = text(body.description, "description", 1, 4000, true);
  if (!description.ok) return description;
  if (typeof body.donation_type !== "string" || !(body.donation_type in DONATION_TYPES)) {
    return { ok: false, error: "donation_type is invalid" };
  }
  const urgency = body.urgency ?? "routine";
  if (urgency !== "routine" && urgency !== "needed_soon" && urgency !== "urgent") {
    return { ok: false, error: "urgency is invalid" };
  }
  const quantity = integer(body.quantity_needed, "quantity_needed", 1, 1_000_000, true);
  if (!quantity.ok) return quantity;
  return {
    ok: true,
    value: {
      title: title.value!,
      description: description.value,
      donation_type: body.donation_type,
      urgency,
      quantity_needed: quantity.value,
    },
  };
}

export type VolunteerEventInput = {
  title: string;
  description: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  volunteers_needed: number;
  requirements: string | null;
};

export function parseVolunteerEventInput(value: unknown): ValidationResult<VolunteerEventInput> {
  const body = recordOf(value);
  if (!body) return { ok: false, error: "Request body must be an object" };
  const title = text(body.title, "title", 1, 160);
  if (!title.ok) return title;
  const description = text(body.description, "description", 1, 4000, true);
  if (!description.ok) return description;
  const requirements = text(body.requirements, "requirements", 1, 2000, true);
  if (!requirements.ok) return requirements;
  const eventDate = parseISODate(body.event_date);
  if (!eventDate) return { ok: false, error: "event_date must be a real YYYY-MM-DD date" };
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (typeof body.start_time !== "string" || !timePattern.test(body.start_time)) {
    return { ok: false, error: "start_time must use HH:MM" };
  }
  if (typeof body.end_time !== "string" || !timePattern.test(body.end_time)) {
    return { ok: false, error: "end_time must use HH:MM" };
  }
  if (body.end_time <= body.start_time) {
    return { ok: false, error: "end_time must be after start_time" };
  }
  const volunteers = integer(body.volunteers_needed ?? 5, "volunteers_needed", 1, 10_000);
  if (!volunteers.ok) return volunteers;
  return {
    ok: true,
    value: {
      title: title.value!,
      description: description.value,
      event_date: eventDate,
      start_time: body.start_time,
      end_time: body.end_time,
      volunteers_needed: volunteers.value!,
      requirements: requirements.value,
    },
  };
}
