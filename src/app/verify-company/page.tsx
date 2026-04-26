import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit";
import { getTranslator } from "@/i18n/server";

type Search = { token?: string };

export const dynamic = "force-dynamic";

export default async function VerifyCompanyPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const t = await getTranslator();
  const { token } = await searchParams;

  if (!token) {
    return <Status icon="warn" title={t("company.verification.bad_token_title")} body={t("company.verification.bad_token_body")} />;
  }

  // Look up the verification row.
  const { data: row } = await supabaseAdmin
    .from("company_verifications")
    .select("id, company_id, expires_at, confirmed_at, contact_email, sudreg_legal_name")
    .eq("token", token)
    .maybeSingle();

  if (!row) {
    return <Status icon="warn" title={t("company.verification.bad_token_title")} body={t("company.verification.bad_token_body")} />;
  }

  // Already confirmed — show success and the slug to navigate to.
  if (row.confirmed_at) {
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("slug, legal_name, display_name")
      .eq("id", row.company_id)
      .maybeSingle();
    return (
      <Status
        icon="ok"
        title={t("company.verification.already_confirmed_title")}
        body={t("company.verification.already_confirmed_body").replace(
          "{name}",
          (company?.display_name as string | null) ?? row.sudreg_legal_name
        )}
        href={company?.slug ? `/company/${company.slug}` : "/dashboard"}
        cta={t("company.verification.go_to_company")}
      />
    );
  }

  // Expired?
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return (
      <Status
        icon="clock"
        title={t("company.verification.expired_title")}
        body={t("company.verification.expired_body")}
      />
    );
  }

  // Confirm: stamp the verification row + company.verified_at, write audit, redirect.
  const now = new Date().toISOString();
  const { error: vErr } = await supabaseAdmin
    .from("company_verifications")
    .update({ confirmed_at: now })
    .eq("id", row.id);
  if (vErr) {
    console.error("[/verify-company] failed to update verification row", vErr);
    return (
      <Status
        icon="warn"
        title={t("company.verification.error_generic")}
        body={vErr.message}
      />
    );
  }
  const { error: cErr } = await supabaseAdmin
    .from("companies")
    .update({ verified_at: now, updated_at: now })
    .eq("id", row.company_id);
  if (cErr) {
    console.error("[/verify-company] failed to stamp companies.verified_at", cErr);
    // Don't block — the verification row is already confirmed, we just couldn't
    // stamp the visible flag. Surface a friendly success page anyway since the
    // audit trail is intact and the next page load will refetch.
  }
  await writeAuditLog(supabaseAdmin, {
    actor_profile_id: null,
    company_id: row.company_id,
    action: "company.verification.confirm",
    entity_type: "company_verification",
    entity_id: row.id,
    payload: { contact_email: row.contact_email },
  });

  // The settings route is /dashboard/company/settings (not slug-segmented);
  // pass the company id via cid so the dashboard's resolveActiveCompany picks
  // the right tenant on landing.
  redirect(`/dashboard/company/settings?cid=${row.company_id}&verified=1`);
}

function Status({
  icon,
  title,
  body,
  href,
  cta,
}: {
  icon: "ok" | "warn" | "clock";
  title: string;
  body: string;
  href?: string;
  cta?: string;
}) {
  const colors =
    icon === "ok"
      ? "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-200"
      : icon === "clock"
      ? "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-200"
      : "bg-red-50 border-red-200 text-red-900 dark:bg-red-950/30 dark:border-red-900 dark:text-red-200";
  const Icon = icon === "ok" ? CheckCircle2 : icon === "clock" ? Clock : AlertTriangle;
  const accent =
    icon === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : icon === "clock"
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400";

  return (
    <main className="mx-auto flex max-w-xl flex-col items-center px-4 py-16">
      <div className={`w-full rounded-2xl border p-6 shadow-sm ${colors}`}>
        <Icon className={`mb-3 h-10 w-10 ${accent}`} aria-hidden />
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed">{body}</p>
        {href && cta ? (
          <Link
            href={href}
            className="mt-4 inline-flex items-center rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
          >
            {cta}
          </Link>
        ) : null}
      </div>
    </main>
  );
}
