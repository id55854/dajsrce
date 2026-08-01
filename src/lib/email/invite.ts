import { Resend } from "resend";
import type { CompanyRole, Locale } from "@/lib/types";

const DEFAULT_FROM = "DajSrce <notifications@resend.dev>";

export async function sendCompanyInviteEmail(input: {
  to: string;
  locale: Locale;
  companyName: string;
  inviterName: string;
  role: CompanyRole;
  acceptUrl: string;
  expiresAt: string;
}): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { sent: false, error: "RESEND_API_KEY not set" };
  }
  const from = process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM;
  const resend = new Resend(key);

  const expiresHuman = new Date(input.expiresAt).toLocaleDateString(
    input.locale === "hr" ? "hr-HR" : "en-GB",
    { day: "numeric", month: "long", year: "numeric" }
  );

  const headerCompanyName = input.companyName.replace(/[\r\n]+/g, " ").trim();
  const subject =
    input.locale === "hr"
      ? `Pozivnica za pridruživanje tvrtki ${headerCompanyName} na DajSrce`
      : `Invitation to join ${headerCompanyName} on DajSrce`;

  const safeCompanyName = escapeHtml(input.companyName);
  const safeInviterName = escapeHtml(input.inviterName);
  const safeRole = escapeHtml(input.role);
  const safeAcceptUrl = escapeHtml(input.acceptUrl);

  const bodyHr = `
    <p>Pozdrav,</p>
    <p><strong>${safeInviterName}</strong> Vas je pozvao/la da se pridružite tvrtki <strong>${safeCompanyName}</strong> na DajSrce kao <em>${safeRole}</em>.</p>
    <p>Pozivnicu možete prihvatiti klikom na sljedeću poveznicu:</p>
    <p><a href="${safeAcceptUrl}" style="display:inline-block;background:#ef4444;color:#fff;padding:10px 18px;border-radius:9999px;text-decoration:none;font-weight:600">Prihvati pozivnicu</a></p>
    <p style="font-size:12px;color:#6b7280">Pozivnica vrijedi do <strong>${expiresHuman}</strong>.</p>
    <p style="font-size:12px;color:#6b7280">Ako ne prepoznajete pošiljatelja, ovu poruku slobodno zanemarite.</p>
    <p>— DajSrce</p>
  `;
  const bodyEn = `
    <p>Hello,</p>
    <p><strong>${safeInviterName}</strong> invited you to join <strong>${safeCompanyName}</strong> on DajSrce as a <em>${safeRole}</em>.</p>
    <p>You can accept the invitation here:</p>
    <p><a href="${safeAcceptUrl}" style="display:inline-block;background:#ef4444;color:#fff;padding:10px 18px;border-radius:9999px;text-decoration:none;font-weight:600">Accept invitation</a></p>
    <p style="font-size:12px;color:#6b7280">This invitation is valid until <strong>${expiresHuman}</strong>.</p>
    <p style="font-size:12px;color:#6b7280">If you don't recognise the sender you can safely ignore this message.</p>
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
