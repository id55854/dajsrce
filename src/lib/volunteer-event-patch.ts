import { VOLUNTEER_EVENT_FIELDS, type VolunteerEventField } from "@/lib/validation";

/** An event as the organisation's own lists read it back from the database. */
export type StoredVolunteerEvent = {
  id: string;
  title: string;
  description?: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  volunteers_needed?: number | null;
  location?: string | null;
  requirements?: string | null;
  contact_person?: string | null;
  contact_phone?: string | null;
};

/** What the event form holds: raw input strings, "" for nothing. */
export type VolunteerEventFormValues = Record<VolunteerEventField, string>;

/** Only these fields may be emptied; the rest are required on every event. */
const OPTIONAL_FIELDS = new Set<VolunteerEventField>([
  "description",
  "location",
  "requirements",
  "contact_person",
  "contact_phone",
]);

/** The form's starting point: a new event's defaults, or a stored event prefilled. */
export function volunteerEventFormValues(event?: StoredVolunteerEvent | null): VolunteerEventFormValues {
  return {
    title: event?.title ?? "",
    description: event?.description ?? "",
    event_date: event?.event_date ?? "",
    // The database answers "09:00:00"; a time input and the API use "09:00".
    start_time: event?.start_time?.slice(0, 5) ?? "09:00",
    end_time: event?.end_time?.slice(0, 5) ?? "12:00",
    location: event?.location ?? "",
    volunteers_needed: event?.volunteers_needed != null ? String(event.volunteers_needed) : "5",
    requirements: event?.requirements ?? "",
    contact_person: event?.contact_person ?? "",
    contact_phone: event?.contact_phone ?? "",
  };
}

function normalized(field: VolunteerEventField, value: string | number | null | undefined): string | number | null {
  if (field === "volunteers_needed") return value === "" || value == null ? null : Number(value);
  if (field === "start_time" || field === "end_time") return typeof value === "string" ? value.slice(0, 5) : null;
  const text = typeof value === "string" ? value.trim() : value ?? null;
  return OPTIONAL_FIELDS.has(field) && text === "" ? null : text;
}

/** The body the API reads for a new event: trimmed text, null for an empty optional field. */
export function volunteerEventBody(values: VolunteerEventFormValues): Record<VolunteerEventField, string | number | null> {
  const body = {} as Record<VolunteerEventField, string | number | null>;
  for (const field of VOLUNTEER_EVENT_FIELDS) body[field] = normalized(field, values[field]);
  return body;
}

/**
 * Only what the organisation actually changed. Resending an unchanged date or
 * place would read as an edit to the transaction, which tells every signed-up
 * volunteer when the date, time or place moves.
 */
export function volunteerEventPatch(
  original: StoredVolunteerEvent,
  values: VolunteerEventFormValues
): Partial<Record<VolunteerEventField, string | number | null>> {
  const patch: Partial<Record<VolunteerEventField, string | number | null>> = {};
  for (const field of VOLUNTEER_EVENT_FIELDS) {
    const next = normalized(field, values[field]);
    if (next !== normalized(field, original[field])) patch[field] = next;
  }
  return patch;
}

/** True when a patch moves the event in a way its volunteers are told about. */
export function patchMovesEvent(patch: Partial<Record<VolunteerEventField, unknown>>): boolean {
  return ["event_date", "start_time", "end_time", "location"].some((field) => field in patch);
}

/**
 * The translation key for a refused create or edit. A 400 names the field
 * that failed validation, which the form explains in the visitor's language;
 * the English `error` beside it is for developers.
 */
export function volunteerEventErrorKey(
  mode: "create" | "edit",
  status: number,
  body: { field?: unknown; code?: unknown } | null,
  fallback: string
): string {
  const field = body?.field;
  if (status === 400 && typeof field === "string" && (VOLUNTEER_EVENT_FIELDS as readonly string[]).includes(field)) {
    return `volunteer_form.error_${field}`;
  }
  if (mode === "create") return fallback;
  if (status === 403) return "volunteer_form.error_forbidden";
  if (status === 404) return "volunteer_form.error_not_found";
  if (status === 409 && body?.code === "capacity_below_signups") return "volunteer_form.error_below_signups";
  if (status === 409 && body?.code === "event_ended") return "volunteer_form.error_ended";
  return fallback;
}

/** Whether an error key belongs to one field, so the form can mark that field. */
export function volunteerEventErrorField(key: string): VolunteerEventField | null {
  if (key === "volunteer_form.error_below_signups") return "volunteers_needed";
  const field = key.startsWith("volunteer_form.error_") ? key.slice("volunteer_form.error_".length) : "";
  return (VOLUNTEER_EVENT_FIELDS as readonly string[]).includes(field) ? (field as VolunteerEventField) : null;
}
