import { describe, expect, it } from "vitest";
import {
  AssociationDirectoryQueryError,
  associationDirectoryRpcArgs,
  isSocialRegistryEntry,
  parseAssociationDirectoryQuery,
  sanitizeDirectoryParams,
} from "./association-registry";

describe("association directory query", () => {
  it("normalizes bounded filters and pagination", () => {
    const parsed = parseAssociationDirectoryQuery(new URLSearchParams({
      q: "  pomoć  ",
      status: "AKTIVAN",
      county: "Grad Zagreb",
      city: "Zagreb",
      form: "UDRUGA",
      sort: "registered_desc",
      page: "3",
      pageSize: "48",
    }));
    expect(parsed).toEqual({
      query: "pomoć",
      status: "AKTIVAN",
      county: "Grad Zagreb",
      city: "Zagreb",
      form: "UDRUGA",
      sort: "registered_desc",
      page: 3,
      pageSize: 48,
    });
    expect(associationDirectoryRpcArgs(parsed)).toMatchObject({
      p_query: "pomoć",
      p_page: 3,
      p_page_size: 48,
    });
  });

  it("shows a register entry only when it is classified as social", () => {
    expect(isSocialRegistryEntry({ category: "soup_kitchen" })).toBe(true);
    expect(isSocialRegistryEntry({ category: "association" })).toBe(false);
    expect(isSocialRegistryEntry({ category: null })).toBe(false);
    expect(isSocialRegistryEntry({})).toBe(false);
  });

  it("browses and searches only the social (classified) subset", () => {
    // DajSrce is only for associations of a social character; the ~40,000
    // unclassified rows are not shown, not even to a typed search.
    expect(associationDirectoryRpcArgs(parseAssociationDirectoryQuery(new URLSearchParams())))
      .toMatchObject({ p_query: null, p_classified_only: true });
    expect(associationDirectoryRpcArgs(parseAssociationDirectoryQuery(
      new URLSearchParams({ county: "Bjelovarsko-bilogorska" })
    ))).toMatchObject({ p_classified_only: true });
    expect(associationDirectoryRpcArgs(parseAssociationDirectoryQuery(
      new URLSearchParams({ q: "kud" })
    ))).toMatchObject({ p_query: "kud", p_classified_only: true });
  });

  it("uses complete-directory defaults", () => {
    expect(parseAssociationDirectoryQuery(new URLSearchParams())).toMatchObject({
      status: null,
      page: 1,
      pageSize: 24,
      sort: "name_asc",
    });
  });

  it("drops what the API would reject instead of failing the whole page", () => {
    const clean = sanitizeDirectoryParams(new URLSearchParams(
      "sort=newest&q=x&page=abc&pageSize=1000&county=Istarska&onboarded=1"
    ));
    expect(clean.toString()).toBe("county=Istarska&onboarded=1");
    expect(() => parseAssociationDirectoryQuery(clean)).not.toThrow();
    // A valid query passes through untouched.
    const valid = "q=crveni&sort=registered_desc&page=2";
    expect(sanitizeDirectoryParams(new URLSearchParams(valid)).toString()).toBe(valid);
  });

  it.each([
    { q: "x" },
    { page: "0" },
    { pageSize: "101" },
    { sort: "drop table" },
  ])("rejects invalid public input %#", (values) => {
    const params = new URLSearchParams(
      Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
    expect(() => parseAssociationDirectoryQuery(params))
      .toThrow(AssociationDirectoryQueryError);
  });
});
