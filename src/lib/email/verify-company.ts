import { Resend } from "resend";
import type { Locale } from "@/lib/types";

const DEFAULT_FROM = "DajSrce <notifications@resend.dev>";

export async function sendCompanyVerificationEmail(input: {
  to: string;
  locale: Locale;
  companyName: string;
  legalName: string;
  initiatorName: string;
  confirmUrl: string;
  expiresAt: string;
}): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { sent: false, error: "RESEND_API_KEY not set" };
  }
  const from = process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM;
  const resend = new Resend(key);

  const expiresHuman = new Date(input.expiresAt).toLocaleString(
    input.locale === "hr" ? "hr-HR" : "en-GB",
    { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }
  );

  const subject =
    input.locale === "hr"
      ? `Potvrda identiteta tvrtke — ${input.companyName}`
      : `Confirm your company identity — ${input.companyName}`;

  const bodyHr = `
    <p>Pozdrav,</p>
    <p><strong>${escapeHtml(input.initiatorName)}</strong> je pokrenuo/la potvrdu identiteta za tvrtku <strong>${escapeHtml(input.legalName)}</strong> na DajSrce.</p>
    <p>Ako prepoznajete ovaj zahtjev, kliknite gumb ispod kako biste potvrdili da kontrolirate ovu e-mail adresu i time potvrdili tvrtku:</p>
    <p><a href="${input.confirmUrl}" style="display:inline-block;background:#10b981;color:#fff;padding:12px 22px;border-radius:9999px;text-decoration:none;font-weight:600">Potvrdi tvrtku</a></p>
    <p style="font-size:12px;color:#6b7280">Poveznica vrijedi do <strong>${expiresHuman}</strong>.</p>
    <p style="font-size:12px;color:#6b7280">Ako ne prepoznajete ovaj zahtjev, slobodno zanemarite poruku — ništa neće biti potvrđeno.</p>
    <p>— DajSrce</p>
  `;
  const bodyEn = `
    <p>Hello,</p>
    <p><strong>${escapeHtml(input.initiatorName)}</strong> started a verification for <strong>${escapeHtml(input.legalName)}</strong> on DajSrce.</p>
    <p>If you recognise this request, click below to confirm you control this email address and verify the company:</p>
    <p><a href="${input.confirmUrl}" style="display:inline-block;background:#10b981;color:#fff;padding:12px 22px;border-radius:9999px;text-decoration:none;font-weight:600">Confirm company</a></p>
    <p style="font-size:12px;color:#6b7280">This link is valid until <strong>${expiresHuman}</strong>.</p>
    <p style="font-size:12px;color:#6b7280">If you don't recognise this request, you can safely ignore this message — nothing will be confirmed.</p>
    <p>— DajSrce</p>
  `;

  const { error } = await resend.emails.send({
    from,
    to: input.to,
    subject,
    html: input.locale === "hr" ? bodyHr : bodyEn,
  });

  if (error) {
    return { sent: false, error: error.message };
  }
  return { sent: true };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
