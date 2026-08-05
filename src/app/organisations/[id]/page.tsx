import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Mail, MapPin } from "lucide-react";
import { getLocale, getTranslator } from "@/i18n/server";
import type { AssociationRegistryEntry } from "@/lib/association-registry";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import {
  Badge,
  Card,
  PageHeader,
  PageShell,
  SectionHeader,
  buttonClasses,
  type BadgeTone,
} from "@/components/ui";

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

/** Same status→tone map as the directory listing. */
function statusTone(status: string): BadgeTone {
  if (status === "AKTIVAN") return "success";
  if (status === "BRISAN") return "neutral";
  return "warning";
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-sm font-medium text-ink-tertiary">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-base leading-6 text-ink">{value}</dd>
    </div>
  );
}

const LINK_CLASSES =
  "rounded text-brand underline underline-offset-2 transition-colors hover:text-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

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
    <PageShell width="wide">
      <Link
        href="/organisations"
        className={buttonClasses({
          variant: "ghost",
          size: "sm",
          className: "mb-4 -ml-4",
        })}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("organisations.back_to_directory")}
      </Link>

      <PageHeader
        eyebrow={t("organisations.official_record")}
        title={organisation.name}
        subtitle={organisation.short_name ?? undefined}
        actions={<Badge tone={statusTone(organisation.status)}>{statusLabel}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <div className="space-y-6">
          <Card padding="lg">
            <SectionHeader title={t("organisations.activity")} />
            <dl className="space-y-5">
              <DetailField label={t("organisations.goals")} value={organisation.goals} />
              <DetailField label={t("organisations.target_groups")} value={organisation.target_groups} />
              <DetailField label={t("organisations.activity_description")} value={organisation.activity_description} />
              <DetailField label={t("organisations.economic_activities")} value={organisation.economic_activities} />
            </dl>
          </Card>

          <Card padding="lg">
            <SectionHeader title={t("organisations.names")} />
            <dl className="grid gap-5 sm:grid-cols-2">
              <DetailField label={t("organisations.other_names")} value={organisation.names_in_other_languages} />
              <DetailField label={t("organisations.other_short_names")} value={organisation.short_names_in_other_languages} />
            </dl>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <SectionHeader title={t("organisations.registry_identity")} />
            <dl className="space-y-4">
              <DetailField label="UDR_ID" value={organisation.id} />
              <DetailField label="OIB" value={organisation.oib || t("organisations.missing_oib")} />
              <DetailField label={t("organisations.registry_number")} value={organisation.registry_number} />
              <DetailField label={t("organisations.form")} value={organisation.legal_form} />
              <DetailField label={t("organisations.registered")} value={date(organisation.registered_on)} />
              <DetailField label={t("organisations.founding_assembly")} value={date(organisation.founding_assembly_on)} />
              <DetailField label={t("organisations.status_changed")} value={date(organisation.status_changed_on)} />
            </dl>
          </Card>

          <Card>
            <SectionHeader title={t("organisations.contact")} />
            <div className="space-y-3 text-base text-ink">
              {organisation.address ? (
                <p className="flex gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                  <span>{organisation.address}</span>
                </p>
              ) : null}
              {organisation.email ? (
                <p className="flex gap-2">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                  <a
                    className={`break-all ${LINK_CLASSES}`}
                    href={`mailto:${encodeURIComponent(organisation.email)}`}
                  >
                    {organisation.email}
                  </a>
                </p>
              ) : null}
              {website ? (
                <p>
                  <a
                    className={`inline-flex items-center gap-1.5 break-all ${LINK_CLASSES}`}
                    href={website}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {organisation.website}
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </a>
                </p>
              ) : null}
              {!organisation.address && !organisation.email && !website ? (
                <p className="text-ink-secondary">{t("organisations.not_available")}</p>
              ) : null}
            </div>
          </Card>

          <Card padding="md" className="bg-surface-sunken shadow-none">
            <SectionHeader title={t("organisations.source_details")} />
            <p className="text-sm text-ink-secondary">{organisation.source.publisher}</p>
            <p className="mt-2 text-sm text-ink-secondary">
              {t("organisations.license")}: {organisation.source.license}
            </p>
            <a
              className={`mt-3 inline-flex items-center gap-1.5 text-sm font-medium ${LINK_CLASSES}`}
              href={organisation.source.dataset_url}
              target="_blank"
              rel="noreferrer"
            >
              {organisation.source.dataset}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Card>
        </aside>
      </div>
    </PageShell>
  );
}
