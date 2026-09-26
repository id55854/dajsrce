import { ORGANISATION } from "./organisation";

/**
 * "Prijavi sadržaj": the notice-and-action channel the Digital Services Act
 * asks a hosting platform to offer for content its users publish.
 *
 * For launch this is an e-mail to the operator's monitored mailbox, prefilled
 * with the page and the need's id so a report can be traced to the exact
 * content without the reporter having to describe where they saw it. Null
 * when no contact mailbox is configured, so the link is left out rather than
 * pointing nowhere.
 */
export const REPORT_CONTENT_SUBJECT = "Prijava sadržaja";

export function reportContentHref({
  pageUrl,
  needId,
}: {
  pageUrl: string;
  needId: string;
}): string | null {
  const to = ORGANISATION.contactEmail;
  if (!to) return null;
  const body = [`Stranica: ${pageUrl}`, `ID potrebe: ${needId}`, "", "Što je sporno:", ""].join("\r\n");
  return `mailto:${to}?subject=${encodeURIComponent(REPORT_CONTENT_SUBJECT)}&body=${encodeURIComponent(body)}`;
}
