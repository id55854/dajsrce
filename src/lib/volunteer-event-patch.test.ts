import { describe, expect, it } from "vitest";
import {
  patchMovesEvent,
  volunteerEventBody,
  volunteerEventErrorField,
  volunteerEventErrorKey,
  volunteerEventFormValues,
  volunteerEventPatch,
  type StoredVolunteerEvent,
} from "./volunteer-event-patch";

const STORED: StoredVolunteerEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Podjela obroka",
  description: null,
  event_date: "2026-10-01",
  start_time: "09:00:00",
  end_time: "12:00:00",
  volunteers_needed: 8,
  location: null,
  requirements: "Udobna obuća",
  contact_person: "Ana Horvat",
  contact_phone: null,
};

describe("event form values", () => {
  it("starts a new event from the usual defaults", () => {
    expect(volunteerEventFormValues()).toEqual({
      title: "",
      description: "",
      event_date: "",
      start_time: "09:00",
      end_time: "12:00",
      location: "",
      volunteers_needed: "5",
      requirements: "",
      contact_person: "",
      contact_phone: "",
    });
  });

  it("prefills a stored event, with times the time input understands", () => {
    expect(volunteerEventFormValues(STORED)).toMatchObject({
      title: "Podjela obroka",
      description: "",
      start_time: "09:00",
      end_time: "12:00",
      volunteers_needed: "8",
      requirements: "Udobna obuća",
      contact_person: "Ana Horvat",
      contact_phone: "",
    });
  });

  it("sends a new event trimmed, with empty optional fields as null", () => {
    const body = volunteerEventBody({
      ...volunteerEventFormValues(),
      title: "  Akcija ",
      event_date: "2026-10-01",
      contact_phone: "  ",
    });
    expect(body).toMatchObject({
      title: "Akcija",
      volunteers_needed: 5,
      contact_phone: null,
      description: null,
      start_time: "09:00",
    });
  });
});

describe("volunteerEventPatch", () => {
  it("is empty when nothing changed, whatever the stored time format", () => {
    expect(volunteerEventPatch(STORED, volunteerEventFormValues(STORED))).toEqual({});
  });

  it("carries only the changed fields, clearing an emptied optional one", () => {
    const values = { ...volunteerEventFormValues(STORED), title: "Podjela obroka ", volunteers_needed: "10", requirements: "" };
    expect(volunteerEventPatch(STORED, values)).toEqual({ volunteers_needed: 10, requirements: null });
  });

  it("tells a move of date, time or place from other edits", () => {
    const moved = volunteerEventPatch(STORED, { ...volunteerEventFormValues(STORED), start_time: "10:00" });
    expect(moved).toEqual({ start_time: "10:00" });
    expect(patchMovesEvent(moved)).toBe(true);
    expect(patchMovesEvent({ location: "Park Maksimir" })).toBe(true);
    expect(patchMovesEvent({ title: "Novi naziv", contact_phone: null })).toBe(false);
  });
});

describe("event form errors", () => {
  it("explains a validation failure by field in both modes", () => {
    expect(volunteerEventErrorKey("create", 400, { field: "contact_phone" }, "fallback")).toBe("volunteer_form.error_contact_phone");
    expect(volunteerEventErrorKey("edit", 400, { field: "event_date" }, "fallback")).toBe("volunteer_form.error_event_date");
    expect(volunteerEventErrorKey("edit", 400, { field: "institution_id" }, "fallback")).toBe("fallback");
  });

  it("maps edit refusals to what the organisation can do about them", () => {
    expect(volunteerEventErrorKey("edit", 403, null, "fallback")).toBe("volunteer_form.error_forbidden");
    expect(volunteerEventErrorKey("edit", 404, null, "fallback")).toBe("volunteer_form.error_not_found");
    expect(volunteerEventErrorKey("edit", 409, { code: "capacity_below_signups" }, "fallback")).toBe("volunteer_form.error_below_signups");
    expect(volunteerEventErrorKey("edit", 409, { code: "event_ended" }, "fallback")).toBe("volunteer_form.error_ended");
    expect(volunteerEventErrorKey("edit", 500, null, "fallback")).toBe("fallback");
    // Publishing keeps its own generic failure for anything but a field.
    expect(volunteerEventErrorKey("create", 403, null, "fallback")).toBe("fallback");
  });

  it("marks the field an error is about", () => {
    expect(volunteerEventErrorField("volunteer_form.error_title")).toBe("title");
    expect(volunteerEventErrorField("volunteer_form.error_below_signups")).toBe("volunteers_needed");
    expect(volunteerEventErrorField("volunteer_form.error_forbidden")).toBeNull();
    expect(volunteerEventErrorField("institution.dashboard_error_event_failed")).toBeNull();
  });
});
