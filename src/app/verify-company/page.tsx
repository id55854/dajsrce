import Link from "next/link";
import { AlertTriangle, CheckCircle2, MailCheck } from "lucide-react";
import { getTranslator } from "@/i18n/server";
import { buttonClasses } from "@/components/ui";

type Search = { token?: string; result?: string; slug?: string };

export const dynamic = "force-dynamic";

/**
 * GET is deliberately inert. Mail scanners and browser prefetching may follow
 * the link, but verification is consumed only by the explicit POST form.
 */
export default async function VerifyCompanyPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const t = await getTranslator();
  const { token = "", result, slug } = await searchParams;

  if (result === "success") {
    return (
      <Status
        icon="ok"
        title={t("company.verification.verified_title")}
        body={t("company.verification.verified_body")}
        href={slug ? `/company/${encodeURIComponent(slug)}` : "/dashboard"}
        cta={t("company.verification.go_to_company")}
      />
    );
  }

  if (result === "failed" || !/^[0-9a-f]{64}$/i.test(token)) {
    return (
      <Status
        icon="warn"
        title={t("company.verification.bad_token_title")}
        body={t("company.verification.bad_token_body")}
      />
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <div className="rounded-card border border-border-subtle bg-surface-raised p-6 shadow-raised">
        <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-info-soft text-info">
          <MailCheck className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-ink">
          Confirm company verification
        </h1>
        <p className="mt-3 text-base leading-7 text-ink-secondary">
          Confirm that you control this verified company contact channel. This action can be
          completed only once.
        </p>
        <form action="/api/companies/verification/confirm" method="post" className="mt-6">
          <input type="hidden" name="token" value={token} />
          {/* Brand red: this is the page's primary action, and emerald is
              reserved for confirmed-success states. */}
          <button type="submit" className={buttonClasses({ size: "lg" })}>
            Confirm company / Potvrdi tvrtku
          </button>
        </form>
      </div>
    </main>
  );
}

function Status({
  icon,
  title,
  body,
  href,
  cta,
}: {
  icon: "ok" | "warn";
  title: string;
  body: string;
  href?: string;
  cta?: string;
}) {
  const ok = icon === "ok";
  const Icon = ok ? CheckCircle2 : AlertTriangle;

  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <div
        className={
          ok
            ? "rounded-card border border-success/30 bg-success-soft p-6 shadow-raised"
            : "rounded-card border border-danger/30 bg-danger-soft p-6 shadow-raised"
        }
      >
        <span
          className={
            ok
              ? "mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised text-success"
              : "mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised text-danger"
          }
        >
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1
          className={`text-2xl font-bold tracking-[-0.02em] ${
            ok ? "text-success-on-soft" : "text-danger-on-soft"
          }`}
        >
          {title}
        </h1>
        <p
          className={`mt-3 text-base leading-7 ${
            ok ? "text-success-on-soft/90" : "text-danger-on-soft/90"
          }`}
        >
          {body}
        </p>
        {href && cta ? (
          <Link href={href} className={buttonClasses({ className: "mt-6" })}>
            {cta}
          </Link>
        ) : null}
      </div>
    </main>
  );
}
