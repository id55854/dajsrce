import type { Metadata } from "next";
import { Building2, HeartHandshake, MapPinned, ShieldCheck } from "lucide-react";
import { getLocale, getTranslator } from "@/i18n/server";
import {
  ORGANISATION,
  organisationAddressLine,
  organisationJsonLd,
} from "@/lib/organisation";
import { Card, PageHeader, PageShell, SectionHeader } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return {
    title: `${t("about.page_title")} | ${ORGANISATION.shortName}`,
    description: t("about.page_subtitle"),
  };
}

const PILLARS = [
  { key: "sources", icon: ShieldCheck },
  { key: "coverage", icon: MapPinned },
  { key: "evidence", icon: HeartHandshake },
] as const;

// The page promises the reader they will learn who is behind DajSrce, so the
// names belong here rather than in a footer. Roles are translated; names are
// not, because a person's name is the same in every locale.
const TEAM = [
  { name: "Ivan Dražetić", roleKey: "strategy" },
  { name: "Ana Gašperov", roleKey: "ai" },
  { name: "Eni Magdalena Oreč", roleKey: "fullstack" },
  { name: "Erna Topalović", roleKey: "vision" },
  { name: "Klara Katić", roleKey: "ml" },
  { name: "Filip Knapić", roleKey: "student" },
] as const;

export default async function AboutPage() {
  const t = await getTranslator();
  const locale = await getLocale();
  const jsonLd = organisationJsonLd(locale, "https://dajsrce.hr/o-nama");

  return (
    <PageShell>
      {/* Structured data mirrors the register facts rendered below, so a
          machine reader and a person see the same identity. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <PageHeader title={t("about.page_title")} subtitle={t("about.page_subtitle")} />

      <section aria-labelledby="about-mission" className="mb-10">
        <SectionHeader id="about-mission" title={t("about.mission_title")} />
        <div className="mt-4 space-y-4 text-base leading-7 text-ink-secondary">
          <p>{t("about.mission_body_1")}</p>
          <p>{t("about.mission_body_2")}</p>
        </div>
      </section>

      <section aria-labelledby="about-team" className="mb-10">
        <SectionHeader id="about-team" title={t("about.team_title")} />
        <p className="mt-4 text-base leading-7 text-ink-secondary">
          {t("about.team_body")}
        </p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TEAM.map(({ name, roleKey }) => (
            <li key={name}>
              <Card className="h-full">
                <p className="text-sm font-semibold text-ink">{name}</p>
                <p className="mt-1 text-sm text-ink-secondary">
                  {t(`about.team_role_${roleKey}`)}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="about-pillars" className="mb-10">
        <SectionHeader id="about-pillars" title={t("about.pillars_title")} />
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {PILLARS.map(({ key, icon: Icon }) => (
            <Card key={key} className="flex h-full flex-col">
              <span
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-brand"
                aria-hidden
              >
                <Icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <h3 className="mt-4 text-base font-semibold text-ink">
                {t(`about.pillar_${key}_title`)}
              </h3>
              <p className="mt-2 text-sm leading-6 text-ink-secondary">
                {t(`about.pillar_${key}_body`)}
              </p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="about-registration">
        <SectionHeader
          id="about-registration"
          title={t("about.registration_title")}
          description={t("about.registration_description")}
        />
        <Card className="mt-4">
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <RegistrationField label={t("about.field_legal_name")} value={ORGANISATION.legalName} />
            <RegistrationField
              label={t("about.field_address")}
              value={organisationAddressLine(locale)}
            />
            <RegistrationField label={t("footer.oib")} value={ORGANISATION.oib} numeric />
            <RegistrationField
              label={t("footer.registration_number")}
              value={ORGANISATION.registrationNumber}
              numeric
            />
            {ORGANISATION.contactEmail ? (
              <RegistrationField
                label={t("about.field_contact")}
                value={ORGANISATION.contactEmail}
              />
            ) : null}
          </dl>

          <p className="mt-6 flex items-start gap-2 rounded-control bg-surface-sunken px-3 py-2 text-sm text-ink-secondary">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t("about.registration_note")}
          </p>
        </Card>
      </section>
    </PageShell>
  );
}

function RegistrationField({
  label,
  value,
  numeric = false,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div>
      <dt className="text-sm font-medium text-ink-tertiary">{label}</dt>
      <dd
        className={`mt-1 text-base leading-6 text-ink${numeric ? " tabular-nums" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
