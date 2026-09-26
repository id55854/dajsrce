import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./security/redirects";
import {
  focusedNeedFrom,
  needAnchorId,
  needPermalink,
  pledgeIntentFrom,
  pledgeReturnPath,
  withoutPledgeIntent,
} from "./pledge-flow";

const NEED = "33333333-3333-4333-8333-333333333333";
const INSTITUTION = "22222222-2222-4222-8222-222222222222";

describe("pledgeReturnPath", () => {
  it("brings the donor back to the giving page with the need named", () => {
    expect(pledgeReturnPath({ pathname: "/doniraj", search: "" }, NEED)).toBe(`/doniraj?pledge=${NEED}`);
    // The explore view lists no needs, so it is dropped.
    expect(pledgeReturnPath({ pathname: "/doniraj", search: "?view=explore" }, NEED)).toBe(`/doniraj?pledge=${NEED}`);
  });

  it("keeps an organisation's page and its query", () => {
    expect(pledgeReturnPath({ pathname: `/institution/${INSTITUTION}`, search: "?tab=needs" }, NEED)).toBe(
      `/institution/${INSTITUTION}?tab=needs&pledge=${NEED}`
    );
  });

  it("sends the map and anywhere else to the giving page, never to /needs", () => {
    for (const pathname of ["/", "/needs", "/volunteer", "/institution/x/y"]) {
      expect(pledgeReturnPath({ pathname, search: "?@45.8,15.9,12" }, NEED)).toBe(`/doniraj?pledge=${NEED}`);
    }
    expect(pledgeReturnPath(null, NEED)).toBe(`/doniraj?pledge=${NEED}`);
  });

  it("survives the sign-in redirect's own path check", () => {
    const next = pledgeReturnPath({ pathname: "/doniraj", search: "" }, NEED);
    expect(safeInternalPath(next)).toBe(next);
  });
});

describe("pledge intent in the URL", () => {
  it("reads only a well-formed need id", () => {
    expect(pledgeIntentFrom(`?pledge=${NEED}`)).toBe(NEED);
    expect(pledgeIntentFrom(`?pledge=${NEED.toUpperCase()}`)).toBe(NEED);
    expect(pledgeIntentFrom("?pledge=1;drop")).toBeNull();
    expect(pledgeIntentFrom("")).toBeNull();
  });

  it("focuses a pending pledge first, then a plain need link", () => {
    expect(focusedNeedFrom(`?need=${NEED}`)).toBe(NEED);
    expect(focusedNeedFrom(`?need=${INSTITUTION}&pledge=${NEED}`)).toBe(NEED);
    expect(focusedNeedFrom("?need=nope")).toBeNull();
  });

  it("drops only the intent when it has been acted on", () => {
    expect(withoutPledgeIntent("/doniraj", `?need=${NEED}&pledge=${NEED}`, "#top")).toBe(`/doniraj?need=${NEED}#top`);
    expect(withoutPledgeIntent("/doniraj", `?pledge=${NEED}`)).toBe("/doniraj");
  });

  it("links and anchors one need", () => {
    expect(needPermalink(NEED)).toBe(`/doniraj?need=${NEED}`);
    expect(needAnchorId(NEED)).toBe(`need-${NEED}`);
  });
});
