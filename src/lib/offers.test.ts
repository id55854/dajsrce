import { describe, expect, it } from "vitest";
import {
  OFFER_LIST_LIMIT,
  OFFER_LIST_LIMIT_MAX,
  OfferValidationError,
  offerErrorStatus,
  offerListItems,
  offerRpcArgs,
  parseOfferClaimDecisionInput,
  parseOfferClaimInput,
  parseOfferCreateInput,
  parseOfferListQuery,
  parseOfferUpdateInput,
  toAuthorOffer,
  toAuthorOfferClaim,
  toInstitutionOfferClaim,
  toOfferBrowseItem,
  toOfferListMeta,
  toPublicOffer,
} from "@/lib/offers";

function query(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

/**
 * A row shaped like a future, careless RPC change: it carries the author's id,
 * an exact coordinate, a street address and contact details alongside the real
 * columns. Nothing from this half may survive the public projection.
 */
const LEAKY_ROW = {
  id: "0f2b9d3c-6b4a-4f57-9a8a-1f2c3d4e5f60",
  title: "Perilica rublja",
  description: "Ispravna, tri godine stara.",
  donation_type: "furniture",
  quantity: 1,
  unit: "kom",
  city: "Split",
  coarse_lat: 43.525,
  coarse_lng: 16.425,
  available_until: "2026-09-01",
  status: "open",
  created_at: "2026-08-12T09:00:00Z",
  // None of the following may ever reach a browser.
  user_id: "11111111-2222-4333-8444-555555555555",
  lat: 43.508_132,
  lng: 16.440_193,
  address: "Ulica kralja Zvonimira 14",
  email: "ana@example.com",
  phone: "+385 91 000 0000",
  contact_person: "Ana",
  claimed_by: "99999999-2222-4333-8444-555555555555",
};

const FORBIDDEN_PUBLIC_FIELDS = [
  "user_id",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "address",
  "email",
  "phone",
  "contact_person",
  "claimed_by",
];

describe("offer list query", () => {
  it("defaults to the open scope with a bounded page", () => {
    const parsed = parseOfferListQuery(query(""));
    expect(parsed).toEqual({
      scope: "open",
      donationType: null,
      city: null,
      query: null,
      limit: OFFER_LIST_LIMIT,
      offset: 0,
    });
  });

  it("accepts the three supported scopes and the bounded filters", () => {
    const parsed = parseOfferListQuery(
      query("scope=inbox&donationType=food&city=Rijeka&q=brasno&limit=60&offset=120")
    );
    expect(parsed.scope).toBe("inbox");
    expect(parsed.donationType).toBe("food");
    expect(parsed.city).toBe("Rijeka");
    expect(parsed.query).toBe("brasno");
    expect(parsed.limit).toBe(OFFER_LIST_LIMIT_MAX);
    expect(parsed.offset).toBe(120);
  });

  it("refuses an unbounded page, an unknown scope and an unsupported type", () => {
    expect(() => parseOfferListQuery(query("limit=5000"))).toThrow(OfferValidationError);
    expect(() => parseOfferListQuery(query("scope=everything"))).toThrow(
      OfferValidationError
    );
    expect(() => parseOfferListQuery(query("donationType=kittens"))).toThrow(
      OfferValidationError
    );
    expect(() => parseOfferListQuery(query("q=a"))).toThrow(OfferValidationError);
    expect(() => parseOfferListQuery(query(`q=${"x".repeat(400)}`))).toThrow(
      OfferValidationError
    );
  });
});

describe("offer creation input", () => {
  const valid = {
    title: "20 kg brašna",
    description: "Neotvoreno, rok trajanja do prosinca.",
    donation_type: "food",
    quantity: 20,
    unit: "kg",
    city: "Osijek",
  };

  it("normalises a valid offer and never invents a location", () => {
    const parsed = parseOfferCreateInput(valid);
    expect(parsed.title).toBe("20 kg brašna");
    expect(parsed.donationType).toBe("food");
    expect(parsed.quantity).toBe(20);
    expect(parsed.city).toBe("Osijek");
    expect(parsed.latitude).toBeNull();
    expect(parsed.longitude).toBeNull();
    expect(parsed.availableUntil).toBeNull();
  });

  it("bounds every text field and the quantity", () => {
    expect(() => parseOfferCreateInput({ ...valid, title: "ab" })).toThrow(
      OfferValidationError
    );
    expect(() =>
      parseOfferCreateInput({ ...valid, title: "x".repeat(121) })
    ).toThrow(OfferValidationError);
    expect(() =>
      parseOfferCreateInput({ ...valid, description: "x".repeat(2001) })
    ).toThrow(OfferValidationError);
    expect(() => parseOfferCreateInput({ ...valid, city: "O" })).toThrow(
      OfferValidationError
    );
    expect(() => parseOfferCreateInput({ ...valid, quantity: 0 })).toThrow(
      OfferValidationError
    );
    expect(() => parseOfferCreateInput({ ...valid, quantity: 100_001 })).toThrow(
      OfferValidationError
    );
    expect(() =>
      parseOfferCreateInput({ ...valid, unit: "x".repeat(33) })
    ).toThrow(OfferValidationError);
  });

  it("requires a complete coordinate pair or none at all", () => {
    expect(() => parseOfferCreateInput({ ...valid, latitude: 45.1 })).toThrow(
      OfferValidationError
    );
    expect(() => parseOfferCreateInput({ ...valid, longitude: 16.1 })).toThrow(
      OfferValidationError
    );
    expect(() =>
      parseOfferCreateInput({ ...valid, latitude: 200, longitude: 16.1 })
    ).toThrow(OfferValidationError);
    const parsed = parseOfferCreateInput({
      ...valid,
      latitude: 45.55,
      longitude: 18.69,
    });
    expect(parsed.latitude).toBe(45.55);
    expect(parsed.longitude).toBe(18.69);
  });

  it("keeps availability inside the allowed window", () => {
    const today = new Date();
    const past = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
    const soon = new Date(today.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    const distant = new Date(today.getTime() + 400 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    expect(
      parseOfferCreateInput({ ...valid, available_until: soon }).availableUntil
    ).toBe(soon);
    expect(() =>
      parseOfferCreateInput({ ...valid, available_until: past })
    ).toThrow(OfferValidationError);
    expect(() =>
      parseOfferCreateInput({ ...valid, available_until: distant })
    ).toThrow(OfferValidationError);
    expect(() =>
      parseOfferCreateInput({ ...valid, available_until: "2026-02-31" })
    ).toThrow(OfferValidationError);
  });

  it("maps onto the RPC argument names", () => {
    const args = offerRpcArgs(parseOfferCreateInput(valid), "actor-1");
    expect(args).toEqual({
      p_actor_id: "actor-1",
      p_title: "20 kg brašna",
      p_description: "Neotvoreno, rok trajanja do prosinca.",
      p_donation_type: "food",
      p_quantity: 20,
      p_unit: "kg",
      p_city: "Osijek",
      p_latitude: null,
      p_longitude: null,
      p_available_until: null,
    });
  });
});

describe("offer update input", () => {
  it("treats a status change and a field edit as different intents", () => {
    expect(parseOfferUpdateInput({ status: "withdrawn" })).toEqual({
      kind: "status",
      status: "withdrawn",
    });
    expect(() =>
      parseOfferUpdateInput({ status: "withdrawn", title: "Novo" })
    ).toThrow(OfferValidationError);
    expect(() => parseOfferUpdateInput({ status: "claimed" })).toThrow(
      OfferValidationError
    );
  });

  it("refuses an empty patch and bounds the fields it accepts", () => {
    expect(() => parseOfferUpdateInput({})).toThrow(OfferValidationError);
    expect(() => parseOfferUpdateInput({ quantity: 0 })).toThrow(OfferValidationError);
    const parsed = parseOfferUpdateInput({ title: "  Perilica  ", available_until: null });
    expect(parsed).toMatchObject({ kind: "fields", title: "Perilica", clearAvailableUntil: true });
  });
});

describe("claim input", () => {
  it("bounds the message and allows none", () => {
    expect(parseOfferClaimInput({}).message).toBeNull();
    expect(parseOfferClaimInput({ message: " Trebamo za obitelj. " }).message).toBe(
      "Trebamo za obitelj."
    );
    expect(() => parseOfferClaimInput({ message: "x".repeat(1001) })).toThrow(
      OfferValidationError
    );
  });

  it("accepts only the three terminal decisions", () => {
    expect(parseOfferClaimDecisionInput({ decision: "accepted" }).decision).toBe(
      "accepted"
    );
    expect(parseOfferClaimDecisionInput({ decision: "withdrawn" }).decision).toBe(
      "withdrawn"
    );
    expect(() => parseOfferClaimDecisionInput({ decision: "requested" })).toThrow(
      OfferValidationError
    );
    expect(() => parseOfferClaimDecisionInput({})).toThrow(OfferValidationError);
  });
});

describe("privacy of the public projection", () => {
  it("drops the author id, exact point, address and contact details", () => {
    const projected = toPublicOffer(LEAKY_ROW);
    for (const field of FORBIDDEN_PUBLIC_FIELDS) {
      expect(projected, `public offer leaked ${field}`).not.toHaveProperty(field);
    }
    expect(Object.keys(projected).sort()).toEqual([
      "available_until",
      "city",
      "coarse_lat",
      "coarse_lng",
      "created_at",
      "description",
      "donation_type",
      "id",
      "quantity",
      "status",
      "title",
      "unit",
    ]);
    // Only the coarse projection survives, and it is not the submitted point.
    expect(projected.coarse_lat).toBe(43.525);
    expect(projected.coarse_lat).not.toBe(LEAKY_ROW.lat);
    expect(projected.coarse_lng).not.toBe(LEAKY_ROW.lng);
  });

  it("adds only the caller's own claim flag to the browse item", () => {
    const item = toOfferBrowseItem({ ...LEAKY_ROW, claimed_by_us: true });
    for (const field of FORBIDDEN_PUBLIC_FIELDS) {
      expect(item, `browse item leaked ${field}`).not.toHaveProperty(field);
    }
    expect(item.claimed_by_us).toBe(true);
    expect(toOfferBrowseItem(LEAKY_ROW).claimed_by_us).toBe(false);
  });

  it("keeps the author view free of the author's own exact location", () => {
    const authorOffer = toAuthorOffer({ ...LEAKY_ROW, updated_at: "2026-08-12T10:00:00Z" });
    for (const field of ["lat", "lng", "address", "user_id"]) {
      expect(authorOffer, `author offer leaked ${field}`).not.toHaveProperty(field);
    }
    expect(authorOffer.claims).toEqual([]);
  });

  it("withholds the organisation's contact until the author accepts", () => {
    const contact = { email: "ured@udruga.hr", phone: "+385 1 000", website: "https://udruga.hr" };
    const pending = toAuthorOfferClaim({
      id: "c1",
      institution_id: "i1",
      institution_name: "Udruga Nada",
      status: "requested",
      contact,
    });
    expect(pending.contact).toBeNull();

    const accepted = toAuthorOfferClaim({
      id: "c1",
      institution_id: "i1",
      institution_name: "Udruga Nada",
      status: "accepted",
      contact,
    });
    expect(accepted.contact).toEqual(contact);
  });

  it("withholds the donor's identity until the author accepts", () => {
    const donor = { name: "Ana", email: "ana@example.com", contact_person: "Ana" };
    const pending = toInstitutionOfferClaim({
      id: "c1",
      status: "requested",
      offer: LEAKY_ROW,
      donor,
    });
    expect(pending.donor).toBeNull();
    for (const field of FORBIDDEN_PUBLIC_FIELDS) {
      expect(pending.offer, `claim offer leaked ${field}`).not.toHaveProperty(field);
    }

    const accepted = toInstitutionOfferClaim({
      id: "c1",
      status: "accepted",
      offer: LEAKY_ROW,
      donor,
    });
    expect(accepted.donor).toEqual(donor);
  });
});

describe("response helpers", () => {
  it("reads bounded list envelopes defensively", () => {
    expect(offerListItems({ items: [1, 2] })).toEqual([1, 2]);
    expect(offerListItems(null)).toEqual([]);
    expect(offerListItems({ items: "nope" })).toEqual([]);
    expect(toOfferListMeta({ total: 3, limit: 30, offset: 0 }, 30)).toEqual({
      total: 3,
      limit: 30,
      offset: 0,
    });
    expect(toOfferListMeta(undefined, 30)).toEqual({ total: 0, limit: 30, offset: 0 });
  });

  it("maps each database error class onto one stable status", () => {
    expect(offerErrorStatus("42501")).toBe(403);
    expect(offerErrorStatus("P0002")).toBe(404);
    expect(offerErrorStatus("22023")).toBe(400);
    expect(offerErrorStatus("23505")).toBe(409);
    expect(offerErrorStatus("23514")).toBe(409);
    expect(offerErrorStatus(undefined)).toBe(500);
  });
});
