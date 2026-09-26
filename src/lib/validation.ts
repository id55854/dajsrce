import { DONATION_TYPES } from "./constants";
import { parseISODate } from "./dates";
import { zagrebToday } from "./volunteer-events";

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
  deadline: string | null;
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
  const deadline = body.deadline == null || body.deadline === "" ? null : parseISODate(body.deadline);
  if (body.deadline != null && body.deadline !== "" && !deadline) {
    return { ok: false, error: "deadline must be a real YYYY-MM-DD date" };
  }
  return {
    ok: true,
    value: {
      title: title.value!,
      description: description.value,
      donation_type: body.donation_type,
      urgency,
      quantity_needed: quantity.value,
      deadline,
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
  /** What a volunteer should know or bring. */
  requirements: string | null;
  /** Where the event happens, when not at the organisation's address. */
  location: string | null;
  /** Published with the event, so volunteers know whom to call. */
  contact_person: string | null;
  contact_phone: string | null;
};

/** Every field an organisation sets on an event, in the order the form shows them. */
export const VOLUNTEER_EVENT_FIELDS = [
  "title",
  "description",
  "event_date",
  "start_time",
  "end_time",
  "location",
  "volunteers_needed",
  "requirements",
  "contact_person",
  "contact_phone",
] as const satisfies readonly (keyof VolunteerEventInput)[];

export type VolunteerEventField = (typeof VOLUNTEER_EVENT_FIELDS)[number];

/**
 * Like ValidationResult, plus the field that failed so the form can say what
 * to fix in the visitor's language; `error` stays an English developer
 * message.
 */
export type VolunteerEventValidation<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; field: VolunteerEventField | null };

const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
/** Digits, spaces and + ( ) / - . ; the same rule as the database check. */
const PHONE_CHARACTERS = /^[\d +()/.-]+$/;

function eventDate(value: unknown, today: string): ValidationResult<string> {
  const date = parseISODate(value);
  if (!date) return { ok: false, error: "event_date must be a real YYYY-MM-DD date" };
  // An event dated in the past would be published invisible and unjoinable.
  if (date < today) return { ok: false, error: "event_date must not be in the past" };
  return { ok: true, value: date };
}

function clock(value: unknown, field: string): ValidationResult<string> {
  if (typeof value !== "string" || !CLOCK.test(value)) {
    return { ok: false, error: `${field} must use HH:MM` };
  }
  return { ok: true, value };
}

function phone(value: unknown): ValidationResult<string | null> {
  const parsed = text(value, "contact_phone", 6, 40, true);
  if (!parsed.ok || parsed.value === null) return parsed;
  if (!PHONE_CHARACTERS.test(parsed.value) || parsed.value.replace(/\D/g, "").length < 6) {
    return { ok: false, error: "contact_phone must contain at least 6 digits and only digits, spaces and + ( ) / - ." };
  }
  return parsed;
}

const VOLUNTEER_EVENT_RULES: {
  [K in VolunteerEventField]: (value: unknown, today: string) => ValidationResult<VolunteerEventInput[K]>;
} = {
  title: (value) => text(value, "title", 1, 160) as ValidationResult<string>,
  description: (value) => text(value, "description", 1, 4000, true),
  event_date: (value, today) => eventDate(value, today),
  start_time: (value) => clock(value, "start_time"),
  end_time: (value) => clock(value, "end_time"),
  location: (value) => text(value, "location", 1, 300, true),
  volunteers_needed: (value) => integer(value, "volunteers_needed", 1, 10_000) as ValidationResult<number>,
  requirements: (value) => text(value, "requirements", 1, 2000, true),
  contact_person: (value) => text(value, "contact_person", 1, 120, true),
  contact_phone: (value) => phone(value),
};

type VolunteerEventOptions = {
  /** The Croatian calendar date the event may not precede; tests pin it. */
  today?: string;
};

/** A new event: every required field present, nothing dated in the past. */
export function parseVolunteerEventInput(
  value: unknown,
  { today = zagrebToday() }: VolunteerEventOptions = {}
): VolunteerEventValidation<VolunteerEventInput> {
  const body = recordOf(value);
  if (!body) return { ok: false, error: "Request body must be an object", field: null };
  const input: Record<string, unknown> = { ...body, volunteers_needed: body.volunteers_needed ?? 5 };
  const fields: Partial<Record<VolunteerEventField, unknown>> = {};
  for (const field of VOLUNTEER_EVENT_FIELDS) {
    const parsed = VOLUNTEER_EVENT_RULES[field](input[field], today);
    if (!parsed.ok) return { ok: false, error: parsed.error, field };
    fields[field] = parsed.value;
  }
  const event = fields as VolunteerEventInput;
  if (event.end_time <= event.start_time) {
    return { ok: false, error: "end_time must be after start_time", field: "end_time" };
  }
  return { ok: true, value: event };
}

export type VolunteerEventPatch = Partial<VolunteerEventInput>;

/**
 * An edit: only the fields being changed, each held to the same rule as on
 * creation, and nothing outside VOLUNTEER_EVENT_FIELDS (never the
 * institution, the counters or an id). A null optional field clears it.
 * Times are compared here only when both arrive; the transaction compares
 * them again after merging the patch with the stored event.
 */
export function parseVolunteerEventPatch(
  value: unknown,
  { today = zagrebToday() }: VolunteerEventOptions = {}
): VolunteerEventValidation<VolunteerEventPatch> {
  const body = recordOf(value);
  if (!body) return { ok: false, error: "Request body must be an object", field: null };
  const keys = Object.keys(body);
  const unknownKey = keys.find((key) => !(VOLUNTEER_EVENT_FIELDS as readonly string[]).includes(key));
  if (unknownKey) return { ok: false, error: `${unknownKey.slice(0, 40)} cannot be changed`, field: null };
  if (keys.length === 0) return { ok: false, error: "Nothing to change", field: null };
  const fields: Partial<Record<VolunteerEventField, unknown>> = {};
  for (const field of VOLUNTEER_EVENT_FIELDS) {
    if (!keys.includes(field)) continue;
    const parsed = VOLUNTEER_EVENT_RULES[field](body[field], today);
    if (!parsed.ok) return { ok: false, error: parsed.error, field };
    fields[field] = parsed.value;
  }
  const patch = fields as VolunteerEventPatch;
  if (patch.start_time && patch.end_time && patch.end_time <= patch.start_time) {
    return { ok: false, error: "end_time must be after start_time", field: "end_time" };
  }
  return { ok: true, value: patch };
}
