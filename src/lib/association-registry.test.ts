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
