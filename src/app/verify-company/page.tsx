import Link from "next/link";
import { AlertTriangle, CheckCircle2, MailCheck } from "lucide-react";
import { getTranslator } from "@/i18n/server";

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

  if (result === "failed") {
    return (
      <Status
        icon="warn"
        title={t("company.verification.bad_token_title")}
        body={t("company.verification.bad_token_body")}
      />
    );
  }

  if (!/^[0-9a-f]{64}$/i.test(token)) {
    return (
      <Status
        icon="warn"
        title={t("company.verification.bad_token_title")}
        body={t("company.verification.bad_token_body")}
      />
    );
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col items-center px-4 py-16">
      <div className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
        <MailCheck className="mb-3 h-10 w-10 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <h1 className="text-xl font-bold">Confirm company verification</h1>
        <p className="mt-2 text-sm leading-relaxed">
          Confirm that you control this verified company contact channel. This action can be
          completed only once.
        </p>
        <form action="/api/companies/verification/confirm" method="post" className="mt-5">
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            className="inline-flex rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
          >
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
  const Icon = icon === "ok" ? CheckCircle2 : AlertTriangle;
  const colors =
    icon === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
      : "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200";
  const accent = icon === "ok" ? "text-emerald-600" : "text-red-600";

  return (
    <main className="mx-auto flex max-w-xl flex-col items-center px-4 py-16">
      <div className={`w-full rounded-2xl border p-6 shadow-sm ${colors}`}>
        <Icon className={`mb-3 h-10 w-10 ${accent}`} aria-hidden />
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed">{body}</p>
        {href && cta ? (
          <Link
            href={href}
            className="mt-4 inline-flex rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-gray-900"
          >
            {cta}
          </Link>
        ) : null}
      </div>
    </main>
  );
}
