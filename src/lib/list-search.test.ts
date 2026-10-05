import { describe, expect, it } from "vitest";
import {
  filterBySearch,
  foldSearchText,
  matchesSearch,
  needSearchFields,
  searchHaystack,
  searchTerms,
  volunteerEventSearchFields,
} from "./list-search";

type SearchableNeed = Parameters<typeof needSearchFields>[0] & { id: string };

const need = (overrides: Partial<SearchableNeed> = {}): SearchableNeed => ({
  id: "n1",
  title: "Zimske jakne za djecu",
  description: "Trebamo tople jakne veličine 120–140.",
  donation_type: "clothes",
  institution: { name: "Udruga Duga", city: "Čakovec" },
  ...overrides,
});

const search = (rows: SearchableNeed[], query: string) =>
  filterBySearch(rows, query, needSearchFields);

describe("list search folding", () => {
  it("folds case and Croatian diacritics, including đ", () => {
    expect(foldSearchText("ČĆĐŠŽ čćđšž Ünïcode")).toBe("ccdsz ccdsz unicode");
  });

  it("splits the query into unique folded terms and ignores blanks", () => {
    expect(searchTerms("  Šibenik,  HRANA hrana  ")).toEqual(["sibenik", "hrana"]);
    expect(searchTerms("   ")).toEqual([]);
    expect(searchTerms("„Dom“ - (Split)")).toEqual(["dom", "split"]);
  });

  it("caps the number of terms", () => {
    expect(searchTerms("a b c d e f g h i j k").length).toBe(8);
  });

  it("never matches a term across two fields", () => {
    const haystack = searchHaystack(["Zagreb", "Split"]);
    expect(matchesSearch(haystack, ["zagrebsplit"])).toBe(false);
    expect(matchesSearch(haystack, ["zagreb", "split"])).toBe(true);
  });
});

describe("needs search", () => {
  const rows = [
    need(),
    need({ id: "n2", title: "Pelene", description: "", donation_type: "hygiene", institution: { name: "Dom Đakovo", city: "Đakovo" } }),
    need({ id: "n3", title: "Konzerve", description: "Trajna hrana", donation_type: "food", institution: { name: "Pučka kuhinja", city: "Split" } }),
  ];

  it("returns the same rows untouched for an empty query", () => {
    expect(search(rows, "")).toBe(rows);
    expect(search(rows, "   ")).toBe(rows);
  });

  it("matches title, description, organisation and city regardless of case and diacritics", () => {
    expect(search(rows, "JAKNE").map((row) => row.id)).toEqual(["n1"]);
    expect(search(rows, "trajna").map((row) => row.id)).toEqual(["n3"]);
    expect(search(rows, "pucka").map((row) => row.id)).toEqual(["n3"]);
    expect(search(rows, "cakovec").map((row) => row.id)).toEqual(["n1"]);
    expect(search(rows, "Čakovec").map((row) => row.id)).toEqual(["n1"]);
  });

  it("finds đ written as d, dj or đ, and dj text by đ", () => {
    for (const query of ["đakovo", "dakovo", "djakovo", "DJAKOVO"]) {
      expect(search(rows, query).map((row) => row.id)).toEqual(["n2"]);
    }
    const dj = [need({ id: "dj", institution: { name: "Udruga Djeca", city: "Djakovo" } })];
    expect(search(dj, "đakovo").map((row) => row.id)).toEqual(["dj"]);
  });

  it("matches both labels of the donation type, with light inflection", () => {
    expect(search(rows, "higijena").map((row) => row.id)).toEqual(["n2"]);
    expect(search(rows, "higijenske potrepstine").map((row) => row.id)).toEqual(["n2"]);
    expect(search(rows, "hygiene").map((row) => row.id)).toEqual(["n2"]);
    expect(search(rows, "odjeća").map((row) => row.id)).toEqual(["n1"]);
    expect(search(rows, "clothes").map((row) => row.id)).toEqual(["n1"]);
  });

  it("requires every term", () => {
    expect(search(rows, "hrana split").map((row) => row.id)).toEqual(["n3"]);
    expect(search(rows, "hrana zagreb")).toEqual([]);
  });

  it("does not stem short terms into noise", () => {
    expect(search(rows, "xyz")).toEqual([]);
    expect(search(rows, "ua")).toEqual([]);
  });

  it("survives a missing organisation or an unknown donation type", () => {
    const odd = [need({ id: "odd", institution: undefined, donation_type: "constructor" })];
    expect(search(odd, "jakne").map((row) => row.id)).toEqual(["odd"]);
    expect(search(odd, "function")).toEqual([]);
  });
});

describe("volunteer event search", () => {
  const events = [
    {
      id: "e1",
      title: "Čišćenje plaže",
      description: "Skupljamo otpad",
      location: "Plaža Žnjan",
      institution: { name: "Zelena Istra", city: "Pula" },
    },
    {
      id: "e2",
      title: "Podjela obroka",
      description: null,
      location: null,
      institution: { name: "Crveni križ", city: "Osijek" },
    },
  ];
  const find = (query: string) =>
    filterBySearch(events, query, volunteerEventSearchFields).map((event) => event.id);

  it("matches title, description, location, organisation and city", () => {
    expect(find("ciscenje")).toEqual(["e1"]);
    expect(find("otpad")).toEqual(["e1"]);
    expect(find("znjan")).toEqual(["e1"]);
    expect(find("crveni kriz")).toEqual(["e2"]);
    expect(find("osijek obrok")).toEqual(["e2"]);
  });
});
