import { Resend } from "resend";
import type { Locale } from "@/lib/types";

const DEFAULT_FROM = "DajSrce <notifications@resend.dev>";

export async function sendReceiptReadyEmail(input: {
  to: string;
  locale: Locale;
  companyName: string;
  fiscalYear: number;
  totalEur: number;
}): Promise<{ sent: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { sent: false, error: "RESEND_API_KEY not set" };
  }
  const from = process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM;
  const resend = new Resend(key);

  const subject =
    input.locale === "hr"
      ? `Nova porezna potvrda — ${input.companyName} (${input.fiscalYear})`
      : `Tax receipt ready — ${input.companyName} (${input.fiscalYear})`;

  const bodyHr = `
    <p>Pozdrav,</p>
    <p>Generirali smo poreznu potvrdu za <strong>${input.companyName}</strong> za fiskalnu godinu <strong>${input.fiscalYear}</strong>.</p>
    <p>Ukupni iznos u dokumentu: <strong>${input.totalEur.toFixed(2)} EUR</strong>.</p>
    <p>Potvrdu možete preuzeti u nadzornoj ploči tvrtke (postavke / potvrde).</p>
    <p>— DajSrce</p>
  `;
  const bodyEn = `
    <p>Hello,</p>
    <p>We generated a tax receipt for <strong>${input.companyName}</strong> for fiscal year <strong>${input.fiscalYear}</strong>.</p>
    <p>Total in the document: <strong>${input.totalEur.toFixed(2)} EUR</strong>.</p>
    <p>Download it from your company dashboard (receipts section).</p>
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
