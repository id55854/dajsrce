import type { Metadata } from "next";
import Link from "next/link";
import { MailX } from "lucide-react";
import { getTranslator } from "@/i18n/server";
import { Card, PageShell, buttonClasses } from "@/components/ui";
import { isUnsubscribeToken } from "@/lib/email/notification-emails";

export const metadata: Metadata = {
  title: "Obavijesti e-poštom",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Search = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? null : null;
}

/**
 * Where the link in every notification e-mail lands. Opening it changes
 * nothing (mail scanners open links too); the button posts the token.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Search }) {
  const t = await getTranslator();
  const params = await searchParams;
  const token = first(params.t);
  const done = first(params.gotovo) === "1";
  const failed = first(params.greska) === "1";
  const valid = isUnsubscribeToken(token);

  let message: string;
  if (done) message = t("account.unsubscribe_done");
  else if (!valid) message = t("account.unsubscribe_invalid");
  else if (failed) message = t("account.unsubscribe_error");
  else message = t("account.unsubscribe_body");

  return (
    <PageShell>
      <Card as="section" padding="lg" className="mx-auto max-w-xl">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
          <MailX className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
          {t("account.unsubscribe_title")}
        </h1>
        <p className="mt-3 text-base leading-7 text-ink-secondary" role={failed ? "alert" : undefined}>
          {message}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {valid && !done ? (
            <form method="post" action="/api/notification-emails/unsubscribe">
              <input type="hidden" name="t" value={token ?? ""} />
              <button type="submit" className={buttonClasses({ variant: "primary" })}>
                {t("account.unsubscribe_button")}
              </button>
            </form>
          ) : null}
          <Link href="/dashboard/postavke" className={buttonClasses({ variant: "secondary" })}>
            {t("account.settings_cta")}
          </Link>
        </div>
      </Card>
    </PageShell>
  );
}
