import { describe, expect, it } from "vitest";
import {
  AssociationDirectoryQueryError,
  associationDirectoryRpcArgs,
  parseAssociationDirectoryQuery,
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

  it("browses the classified subset but searches the whole register", () => {
    // Browsing keeps the map's social default; a typed name must reach the
    // ~40,000 unclassified rows too, or a KUD looking itself up finds nothing.
    expect(associationDirectoryRpcArgs(parseAssociationDirectoryQuery(new URLSearchParams())))
      .toMatchObject({ p_query: null, p_classified_only: true });
    expect(associationDirectoryRpcArgs(parseAssociationDirectoryQuery(
      new URLSearchParams({ county: "Bjelovarsko-bilogorska" })
    ))).toMatchObject({ p_classified_only: true });
    expect(associationDirectoryRpcArgs(parseAssociationDirectoryQuery(
      new URLSearchParams({ q: "kud" })
    ))).toMatchObject({ p_query: "kud", p_classified_only: false });
  });

  it("uses complete-directory defaults", () => {
    expect(parseAssociationDirectoryQuery(new URLSearchParams())).toMatchObject({
      status: null,
      page: 1,
      pageSize: 24,
      sort: "name_asc",
    });
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
