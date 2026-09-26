/**
 * Rules of the donor's pledge flow that more than one surface shares.
 *
 * A signed-out donor who presses "Mogu pomoći" is sent to sign in, and used to
 * come back to the generic `/needs` redirect: the need they chose, and the
 * intent to pledge to it, were both lost. The return path now names the need
 * (`?pledge=<id>`), and whichever card shows that need reopens its dialog.
 */
export const PLEDGE_INTENT_PARAM = "pledge";
/** A link to one need on the giving page, e.g. from a notification. */
export const NEED_FOCUS_PARAM = "need";

/**
 * Upper bounds for one pledge, shared by the form and `POST /api/pledges`.
 * A need with a target is further capped at what is still missing, which
 * `create_pledge_transaction` enforces under a row lock; these stop absurd
 * figures on needs without a target and in the optional estimated value.
 */
export const PLEDGE_QUANTITY_MAX = 10_000;
export const PLEDGE_AMOUNT_EUR_MAX = 100_000;
export const PLEDGE_MESSAGE_MAX = 2000;

/** The most a donor can pledge now: what is still missing, within the cap. */
export function pledgeQuantityCap(remaining: number | null | undefined): number {
  return remaining != null && remaining > 0 ? Math.min(remaining, PLEDGE_QUANTITY_MAX) : PLEDGE_QUANTITY_MAX;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The element id of a need's card, so a link can scroll it into view. */
export function needAnchorId(needId: string): string {
  return `need-${needId}`;
}

/** `/doniraj?need=<id>`: the need, on the page that lists every open need. */
export function needPermalink(needId: string): string {
  return `/doniraj?${NEED_FOCUS_PARAM}=${encodeURIComponent(needId)}`;
}

/**
 * Where a signed-out donor returns after signing in, to finish pledging.
 *
 * The giving page and an organisation's page list their needs directly, so
 * the donor comes back to the page they were on. Anywhere else (the map shows
 * needs only inside a detail panel the visitor would have to reopen) sends
 * them to the giving page, which lists every open need.
 */
export function pledgeReturnPath(
  location: { pathname: string; search: string } | null | undefined,
  needId: string
): string {
  const pathname = location?.pathname ?? "";
  const listsNeeds = pathname === "/doniraj" || /^\/institution\/[^/]+$/.test(pathname);
  if (!listsNeeds) return `/doniraj?${PLEDGE_INTENT_PARAM}=${encodeURIComponent(needId)}`;
  const params = new URLSearchParams(location?.search ?? "");
  params.set(PLEDGE_INTENT_PARAM, needId);
  // The giving page's other view is the wizard, which lists no needs.
  if (pathname === "/doniraj") params.delete("view");
  return `${pathname}?${params.toString()}`;
}

function uuidParam(search: string, name: string): string | null {
  const value = new URLSearchParams(search).get(name);
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

/** The need a donor came back to pledge to, if the URL names a valid one. */
export function pledgeIntentFrom(search: string): string | null {
  return uuidParam(search, PLEDGE_INTENT_PARAM);
}

/** The need a link points at: a pending pledge, or a plain `?need=` link. */
export function focusedNeedFrom(search: string): string | null {
  return pledgeIntentFrom(search) ?? uuidParam(search, NEED_FOCUS_PARAM);
}

/** The current address without the pledge intent, for `history.replaceState`. */
export function withoutPledgeIntent(pathname: string, search: string, hash = ""): string {
  const params = new URLSearchParams(search);
  params.delete(PLEDGE_INTENT_PARAM);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

/** Forget the intent once acted on, so a reload does not reopen the dialog. */
export function clearPledgeIntent(): void {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  window.history.replaceState(window.history.state, "", withoutPledgeIntent(pathname, search, hash));
}
