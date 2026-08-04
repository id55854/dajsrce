import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, ExternalLink, Mail, MapPin } from "lucide-react";
import { getLocale, getTranslator } from "@/i18n/server";
import type { AssociationRegistryEntry } from "@/lib/association-registry";
import { createPublicSupabaseClient } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Registar udruga | DajSrce",
  description: "Službeni podaci iz Registra udruga Republike Hrvatske.",
};

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function statusClass(status: string) {
  if (status === "AKTIVAN") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
  if (status === "BRISAN") return "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  );
}

export default async function OrganisationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^\d{1,20}$/.test(id)) notFound();
  const [t, locale] = await Promise.all([getTranslator(), getLocale()]);
  const supabase = createPublicSupabaseClient();
  const { data, error } = await supabase.rpc("get_association_registry_entry_v1", { p_udr_id: id });
  if (error) throw new Error(`Official registry detail failed (${error.code ?? "database"})`);
  if (!data) notFound();
  const organisation = data as AssociationRegistryEntry;
  const website = safeHttpUrl(organisation.website);
  const date = (value: string | null) => value
    ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(`${value}T00:00:00Z`))
    : null;
  const statusLabel = organisation.status === "AKTIVAN"
    ? t("organisations.status_active")
    : organisation.status === "BRISAN"
      ? t("organisations.status_deleted")
      : organisation.status === "PRESTANAK DJELOVANJA"
        ? t("organisations.status_ceased")
        : organisation.status;

  return (
    <div className="bg-gray-50 py-8 dark:bg-gray-950 sm:py-12">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <Link href="/organisations" className="inline-flex items-center gap-2 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("organisations.back_to_directory")}
        </Link>

        <article className="mt-5 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <header className="border-b border-gray-200 bg-gradient-to-br from-red-50 to-amber-50 p-6 dark:border-gray-800 dark:from-red-950/30 dark:to-amber-950/20 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex max-w-3xl items-start gap-4">
                <span className="rounded-2xl bg-white p-3 text-red-600 shadow-sm dark:bg-gray-900 dark:text-red-400">
                  <Building2 className="h-7 w-7" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">
                    {t("organisations.official_record")}
                  </p>
                  <h1 className="mt-2 text-2xl font-bold leading-tight text-gray-950 dark:text-white sm:text-3xl">
                    {organisation.name}
                  </h1>
                  {organisation.short_name ? <p className="mt-2 text-gray-600 dark:text-gray-300">{organisation.short_name}</p> : null}
                </div>
              </div>
              <span className={`rounded-full px-3 py-1.5 text-sm font-semibold ${statusClass(organisation.status)}`}>
                {statusLabel}
              </span>
            </div>
          </header>

          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
            <div className="space-y-8">
              <section>
                <h2 className="text-lg font-semibold">{t("organisations.activity")}</h2>
                <dl className="mt-4 space-y-5">
                  <DetailField label={t("organisations.goals")} value={organisation.goals} />
                  <DetailField label={t("organisations.target_groups")} value={organisation.target_groups} />
                  <DetailField label={t("organisations.activity_description")} value={organisation.activity_description} />
                  <DetailField label={t("organisations.economic_activities")} value={organisation.economic_activities} />
                </dl>
              </section>

              <section>
                <h2 className="text-lg font-semibold">{t("organisations.names")}</h2>
                <dl className="mt-4 grid gap-5 sm:grid-cols-2">
                  <DetailField label={t("organisations.other_names")} value={organisation.names_in_other_languages} />
                  <DetailField label={t("organisations.other_short_names")} value={organisation.short_names_in_other_languages} />
                </dl>
              </section>
            </div>

            <aside className="space-y-6">
              <section className="rounded-2xl border border-gray-200 p-5 dark:border-gray-700">
                <h2 className="font-semibold">{t("organisations.registry_identity")}</h2>
                <dl className="mt-4 space-y-4">
                  <DetailField label="UDR_ID" value={organisation.id} />
                  <DetailField label="OIB" value={organisation.oib || t("organisations.missing_oib")} />
                  <DetailField label={t("organisations.registry_number")} value={organisation.registry_number} />
                  <DetailField label={t("organisations.form")} value={organisation.legal_form} />
                  <DetailField label={t("organisations.registered")} value={date(organisation.registered_on)} />
                  <DetailField label={t("organisations.founding_assembly")} value={date(organisation.founding_assembly_on)} />
                  <DetailField label={t("organisations.status_changed")} value={date(organisation.status_changed_on)} />
                </dl>
              </section>

              <section className="rounded-2xl border border-gray-200 p-5 dark:border-gray-700">
                <h2 className="font-semibold">{t("organisations.contact")}</h2>
                <div className="mt-4 space-y-3 text-sm">
                  {organisation.address ? (
                    <p className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden="true" /><span>{organisation.address}</span></p>
                  ) : null}
                  {organisation.email ? (
                    <p className="flex gap-2"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden="true" /><a className="break-all text-red-600 underline dark:text-red-400" href={`mailto:${encodeURIComponent(organisation.email)}`}>{organisation.email}</a></p>
                  ) : null}
                  {website ? (
                    <p><a className="inline-flex items-center gap-1.5 break-all text-red-600 underline dark:text-red-400" href={website} target="_blank" rel="noreferrer">{organisation.website}<ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /></a></p>
                  ) : null}
                  {!organisation.address && !organisation.email && !website ? <p>{t("organisations.not_available")}</p> : null}
                </div>
              </section>

              <section className="rounded-2xl bg-gray-100 p-5 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                <h2 className="font-semibold text-gray-950 dark:text-white">{t("organisations.source_details")}</h2>
                <p className="mt-3">{organisation.source.publisher}</p>
                <p className="mt-2">{t("organisations.license")}: {organisation.source.license}</p>
                <a className="mt-3 inline-flex items-center gap-1.5 font-medium text-red-600 underline dark:text-red-400" href={organisation.source.dataset_url} target="_blank" rel="noreferrer">
                  {organisation.source.dataset} <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </section>
            </aside>
          </div>
        </article>
      </div>
    </div>
  );
}
