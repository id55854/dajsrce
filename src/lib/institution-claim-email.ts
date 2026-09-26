import type { Locale } from "@/lib/types";
import { ORGANISATION } from "@/lib/organisation";

/**
 * The mailbox-challenge message sent to the address the official register
 * publishes for an association.
 *
 * Built here, apart from the route, so the parts that are easy to get subtly
 * wrong stay testable: the subject is plain text (a name with quotes must not
 * arrive as `&quot;`), only the HTML part is escaped, and every value that
 * lands in a header is flattened to one line.
 */

export type ClaimChallengeEmailInput = {
  locale: Locale;
  organisationName: string;
  /** The applicant's profile name. Self-declared, so it is quoted, never vouched for. */
  applicantName: string | null | undefined;
  confirmUrl: string;
  expiresAt: string;
};

export type ClaimChallengeEmail = {
  subject: string;
  html: string;
  text: string;
};

const SUBJECT_NAME_MAX_LENGTH = 120;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One line: CR, LF and every other control character become a single space. */
export function singleLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

const COPY = {
  hr: {
    fallbackApplicant: "Korisnik DajSrca",
    subject: (organisation: string) =>
      `Potvrdite zahtjev za upravljanje udrugom: ${organisation}`,
    greeting: "Pozdrav,",
    request: (organisation: string) =>
      `na platformi DajSrce zaprimili smo zahtjev za upravljanje profilom udruge ${organisation}.`,
    applicant: (applicant: string) =>
      `Podnositelj zahtjeva predstavio se imenom: ${applicant}.`,
    why: "Ova poruka poslana je na adresu koju za tu udrugu objavljuje službeni Registar udruga. Ako prepoznajete zahtjev, potvrdite da kontrolirate ovu adresu:",
    button: "Potvrdi e-adresu",
    expiry: (when: string) =>
      `Poveznica vrijedi do ${when} i može se iskoristiti samo jednom.`,
    notApproval:
      "Potvrda e-adrese ne odobrava zahtjev: svaki zahtjev pregledava administrator DajSrca.",
    ignore:
      "Ako ne prepoznajete ovaj zahtjev, zanemarite poruku i ništa se neće dogoditi.",
    questions: (contact: string) =>
      `Pitanja nam možete poslati odgovorom na ovu poruku ili na ${contact}.`,
  },
  en: {
    fallbackApplicant: "A DajSrce user",
    subject: (organisation: string) =>
      `Confirm the request to manage ${organisation} on DajSrce`,
    greeting: "Hello,",
    request: (organisation: string) =>
      `DajSrce has received a request to manage the profile of ${organisation}.`,
    applicant: (applicant: string) =>
      `The person making the request gave their name as: ${applicant}.`,
    why: "This message was sent to the address the official Associations Register publishes for that organisation. If you recognise the request, confirm you control this mailbox:",
    button: "Confirm email address",
    expiry: (when: string) => `This link is valid until ${when} and can be used once.`,
    notApproval:
      "Confirming the email does not approve the request: every request is reviewed by a DajSrce administrator.",
    ignore: "If you do not recognise this request, ignore this message and nothing will happen.",
    questions: (contact: string) =>
      `You can send questions by replying to this message or to ${contact}.`,
  },
} as const;

export function buildClaimChallengeEmail(input: ClaimChallengeEmailInput): ClaimChallengeEmail {
  const copy = input.locale === "en" ? COPY.en : COPY.hr;
  const organisation = singleLine(input.organisationName);
  const applicant = singleLine(input.applicantName ?? "") || copy.fallbackApplicant;
  const expires = new Date(input.expiresAt).toLocaleString(
    input.locale === "en" ? "en-GB" : "hr-HR",
    {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Zagreb",
    }
  );
  const contact = ORGANISATION.contactEmail;

  // Plain text for the header: a name with quotes or an ampersand must read
  // as written, so only the HTML part below is escaped.
  const subject = singleLine(
    copy.subject(truncate(organisation, SUBJECT_NAME_MAX_LENGTH))
  );

  const muted = 'style="font-size:12px;color:#6b7280"';
  const html = `
    <p>${escapeHtml(copy.greeting)}</p>
    <p>${escapeHtml(copy.request(organisation))}</p>
    <p>${escapeHtml(copy.applicant(applicant))}</p>
    <p>${escapeHtml(copy.why)}</p>
    <p><a href="${escapeHtml(input.confirmUrl)}" style="display:inline-block;background:#10b981;color:#fff;padding:12px 22px;border-radius:9999px;text-decoration:none;font-weight:600">${escapeHtml(copy.button)}</a></p>
    <p ${muted}>${escapeHtml(copy.expiry(expires))}</p>
    <p ${muted}>${escapeHtml(copy.notApproval)}</p>
    <p ${muted}>${escapeHtml(copy.ignore)}</p>
    ${contact ? `<p ${muted}>${escapeHtml(copy.questions(contact))}</p>` : ""}
    <p>DajSrce</p>
  `;

  const text = [
    copy.greeting,
    "",
    copy.request(organisation),
    copy.applicant(applicant),
    "",
    copy.why,
    input.confirmUrl,
    "",
    copy.expiry(expires),
    copy.notApproval,
    copy.ignore,
    ...(contact ? [copy.questions(contact)] : []),
    "",
    "DajSrce",
  ].join("\n");

  return { subject, html, text };
}

export type ClaimEmailSender = {
  apiKey: string;
  from: string;
  replyTo: string | null;
};

/**
 * Resend credentials and a verified sender, or null. There is deliberately no
 * fallback sender: `resend.dev` only delivers to the Resend account owner, so
 * a fallback would look like a sent challenge that nobody ever receives.
 */
export function claimEmailSender(
  env: Record<string, string | undefined> = process.env
): ClaimEmailSender | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from, replyTo: ORGANISATION.contactEmail };
}
