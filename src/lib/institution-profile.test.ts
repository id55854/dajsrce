import { describe, expect, it } from "vitest";
import {
  applyProfileResult,
  changedProfileFields,
  institutionProfileErrorKey,
  missingProfileEssentials,
  normalizeWebsite,
  parseInstitutionProfilePatch,
  profileDraftFrom,
  profileFieldFromMessage,
} from "./institution-profile";
import type { PublicInstitutionDetail } from "./location-map";

const detail: PublicInstitutionDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "UDRUGA TEST",
  category: "association",
  description: "Opis iz registra",
  address: "Ilica 1",
  city: "Zagreb",
  latitude: 45.81,
  longitude: 15.97,
  phone: null,
  email: "udruga@example.org",
  website: null,
  workingHours: null,
  dropOffHours: null,
  acceptsDonations: [],
  capacity: null,
  servedPopulation: null,
  photoUrl: null,
  isVerified: true,
  isLocationHidden: false,
  approximateArea: null,
  nearestZetStop: null,
  zetLines: null,
  trustStatus: "contact_verified",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

describe("parseInstitutionProfilePatch", () => {
  it("accepts the allowed fields and trims them", () => {
    const result = parseInstitutionProfilePatch({
      description: "  Pomažemo obiteljima.  ",
      phone: " +385 (1) 234-5678 ",
      email: "kontakt@udruga.hr",
      website: "www.udruga.hr",
      working_hours: "pon–pet 9–17 h",
      drop_off_hours: "utorkom 10–14 h, ulaz iz dvorišta",
      accepts_donations: ["food", "clothes", "food"],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        description: "Pomažemo obiteljima.",
        phone: "+385 (1) 234-5678",
        email: "kontakt@udruga.hr",
        website: "https://www.udruga.hr",
        working_hours: "pon–pet 9–17 h",
        drop_off_hours: "utorkom 10–14 h, ulaz iz dvorišta",
        // Deduplicated and in the one canonical order.
        accepts_donations: ["clothes", "food"],
      },
    });
  });

  it("clears a text field that is emptied", () => {
    expect(parseInstitutionProfilePatch({ phone: "   ", website: "", description: null })).toEqual({
      ok: true,
      value: { phone: null, website: null, description: null },
    });
  });

  it.each(["name", "category", "address", "lat", "institution_id"])(
    "refuses the register-owned or unknown field %s",
    (key) => {
      const result = parseInstitutionProfilePatch({ [key]: "x" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.field).toBeNull();
    }
  );

  it("refuses an empty patch and a non-object body", () => {
    expect(parseInstitutionProfilePatch({}).ok).toBe(false);
    expect(parseInstitutionProfilePatch([]).ok).toBe(false);
    expect(parseInstitutionProfilePatch("phone").ok).toBe(false);
  });

  it.each(["12345", "abc-12345678", "091 234 5678 ext 5", "------", "1".repeat(41)])(
    "names the phone field for %s",
    (phone) => {
      const result = parseInstitutionProfilePatch({ phone });
      expect(result).toMatchObject({ ok: false, field: "phone" });
    }
  );

  it("validates e-mail, website, lengths and donation types by field", () => {
    expect(parseInstitutionProfilePatch({ email: "not-an-email" })).toMatchObject({ ok: false, field: "email" });
    expect(parseInstitutionProfilePatch({ website: "javascript:alert(1)" })).toMatchObject({ ok: false, field: "website" });
    expect(parseInstitutionProfilePatch({ description: "x".repeat(2001) })).toMatchObject({ ok: false, field: "description" });
    expect(parseInstitutionProfilePatch({ drop_off_hours: "x".repeat(301) })).toMatchObject({ ok: false, field: "drop_off_hours" });
    expect(parseInstitutionProfilePatch({ accepts_donations: ["food", "gold"] })).toMatchObject({ ok: false, field: "accepts_donations" });
    expect(parseInstitutionProfilePatch({ accepts_donations: "food" })).toMatchObject({ ok: false, field: "accepts_donations" });
    expect(parseInstitutionProfilePatch({ working_hours: 9 })).toMatchObject({ ok: false, field: "working_hours" });
  });

  it("allows an organisation to say it accepts nothing", () => {
    expect(parseInstitutionProfilePatch({ accepts_donations: [] })).toEqual({
      ok: true,
      value: { accepts_donations: [] },
    });
  });
});

describe("normalizeWebsite", () => {
  it("adds https to a bare host and keeps a full address", () => {
    expect(normalizeWebsite("udruga.hr/o-nama")).toBe("https://udruga.hr/o-nama");
    expect(normalizeWebsite("http://udruga.hr")).toBe("http://udruga.hr");
  });

  it.each(["mailto:a@b.hr", "ftp://udruga.hr", "https://localhost", "https://user:pw@udruga.hr", "", null])(
    "refuses %s",
    (value) => {
      expect(normalizeWebsite(value)).toBeNull();
    }
  );
});

describe("profile form helpers", () => {
  it("sends only the fields that changed, never an untouched donation list", () => {
    const initial = profileDraftFrom({ ...detail, acceptsDonations: ["food"] });
    expect(changedProfileFields(initial, { ...initial })).toEqual({});
    expect(
      changedProfileFields(initial, {
        ...initial,
        phone: "01 234 5678",
        email: " udruga@example.org ",
        accepts_donations: ["food"],
      })
    ).toEqual({ phone: "01 234 5678" });
    expect(changedProfileFields(initial, { ...initial, accepts_donations: [] })).toEqual({
      accepts_donations: [],
    });
  });

  it("names what a donor still cannot do without", () => {
    expect(missingProfileEssentials(detail)).toEqual(["phone", "drop_off_hours", "accepts_donations"]);
    expect(
      missingProfileEssentials({ ...detail, phone: "01 234 5678", dropOffHours: "pon 9–12", acceptsDonations: ["food"] })
    ).toEqual([]);
  });

  it("folds the saved profile back into the public detail", () => {
    const next = applyProfileResult(detail, {
      id: detail.id,
      name: detail.name,
      description: null,
      phone: "01 234 5678",
      email: null,
      website: "https://udruga.hr",
      working_hours: null,
      drop_off_hours: "pon 9–12",
      accepts_donations: ["hygiene", "food"],
      donation_acceptance_confirmed: true,
      updated_at: "2026-09-26T10:00:00Z",
    });
    expect(next).toMatchObject({
      name: "UDRUGA TEST",
      description: "",
      phone: "01 234 5678",
      email: null,
      website: "https://udruga.hr",
      dropOffHours: "pon 9–12",
      acceptsDonations: ["food", "hygiene"],
      updatedAt: "2026-09-26T10:00:00Z",
    });
  });

  it("maps a refusal to a translation key", () => {
    expect(institutionProfileErrorKey(400, "phone")).toBe("institution_profile.error_phone");
    expect(institutionProfileErrorKey(400, null)).toBe("institution_profile.error_invalid");
    expect(institutionProfileErrorKey(403, null)).toBe("institution_profile.error_forbidden");
    expect(institutionProfileErrorKey(429, null)).toBe("auth.error_rate_limited");
    expect(institutionProfileErrorKey(503, null)).toBe("institution_profile.error_generic");
  });

  it("reads the field name out of a database validation message", () => {
    expect(profileFieldFromMessage("drop_off_hours must be at most 300 characters")).toBe("drop_off_hours");
    expect(profileFieldFromMessage("invalid phone")).toBe("phone");
    expect(profileFieldFromMessage("something else")).toBeNull();
    expect(profileFieldFromMessage(null)).toBeNull();
  });
});
