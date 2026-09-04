import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, PackageSearch } from "lucide-react";
import { InstitutionDetailPanel } from "@/components/InstitutionDetailPanel";
import { NeedCard, type NeedCardNeed } from "@/components/NeedCard";
import {
  EmptyState,
  PageShell,
  SectionHeader,
  buttonClasses,
} from "@/components/ui";
import { getCurrentUserProfile } from "@/lib/auth/server";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { logError } from "@/lib/observability";
import { isUuid } from "@/lib/security/http";
import { trustStatus, type PublicInstitutionDetail } from "@/lib/location-map";
import { getTranslator } from "@/i18n/server";
import type { DonationType, InstitutionCategory } from "@/lib/types";

type DetailRpcRow = {
  id: string;
  name: string;
  category: InstitutionCategory;
  description: string;
  address: string | null;
  city: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  email: string | null;
  website: string | null;
  working_hours: string | null;
  drop_off_hours: string | null;
  accepts_donations: DonationType[] | null;
  capacity: string | null;
  served_population: string | null;
  photo_url: string | null;
  is_verified: boolean | null;
  is_location_hidden: boolean | null;
  approximate_area: string | null;
  nearest_zet_stop: string | null;
  zet_lines: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
};

function toPublicDetail(row: DetailRpcRow): PublicInstitutionDetail {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    address: row.is_location_hidden ? null : row.address,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
    phone: row.phone,
    email: row.email,
    website: row.website,
    workingHours: row.working_hours,
    dropOffHours: row.drop_off_hours,
    acceptsDonations: row.accepts_donations ?? [],
    capacity: row.capacity,
    servedPopulation: row.served_population,
    photoUrl: row.photo_url,
    isVerified: Boolean(row.is_verified),
    isLocationHidden: Boolean(row.is_location_hidden),
    approximateArea: row.approximate_area,
    nearestZetStop: row.nearest_zet_stop,
    zetLines: row.zet_lines,
    trustStatus: trustStatus(Boolean(row.is_verified), row.source),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A missing row and a failed query are different outcomes: the first is a real
 * 404, the second must not tell the visitor the institution does not exist.
 */
type InstitutionPageData =
  | {
      status: "ok";
      institution: PublicInstitutionDetail;
      needs: NeedCardNeed[];
    }
  | { status: "missing" }
  | { status: "error" };

const getInstitution = cache(
  async (id: string): Promise<InstitutionPageData> => {
    if (!isUuid(id)) return { status: "missing" };

    try {
      const supabase = createPublicSupabaseClient();
      const { data, error } = await supabase.rpc("public_institution_detail_v1", {
        p_id: id,
      });
      if (error) throw new Error(`Institution detail query failed (${error.code})`);

      const row = ((data ?? []) as DetailRpcRow[])[0];
      if (!row) return { status: "missing" };
      const institution = toPublicDetail(row);
      const { data: needRows, error: needsError } = await supabase
        .from("needs")
        .select(
          "id,institution_id,title,description,donation_type,urgency,quantity_needed,quantity_pledged,quantity_delivered,photo_url,deadline,is_fulfilled,created_at"
        )
        .eq("institution_id", id)
        .eq("is_fulfilled", false)
        .order("urgency", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(100);
      if (needsError) throw new Error(`Institution needs query failed (${needsError.code})`);

      const needInstitution = {
        id: institution.id,
        name: institution.name,
        category: institution.category,
        address:
          institution.address ?? institution.approximateArea ?? institution.city,
        city: institution.city,
      };
      return {
        status: "ok",
        institution,
        needs: (needRows ?? []).map((need) => ({
          ...need,
          institution: needInstitution,
        })) as NeedCardNeed[],
      };
    } catch (error) {
      logError("institution_public_page_query_failed", error, {
        institutionId: id,
      });
      return { status: "error" };
    }
  }
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await getInstitution(id);

  if (data.status === "missing") {
    const t = await getTranslator();
    return { title: `${t("institution_page.not_found")} | DajSrce` };
  }
  if (data.status === "error") return { title: "DajSrce" };

  const { institution } = data;
  const description =
    institution.description.length > 160
      ? `${institution.description.slice(0, 157)}…`
      : institution.description;
  return {
    title: `${institution.name} | DajSrce`,
    description,
  };
}

export default async function InstitutionPublicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslator();
  const data = await getInstitution(id);

  // Giving is a citizen action, so an NGO account gets the needs list without
  // a pledge CTA. Read from `profiles`, and a signed-out visitor keeps the CTA
  //, PledgeButton walks them through signing in.
  const viewer = await getCurrentUserProfile();
  const viewerCanPledge = viewer?.role !== "ngo";

  // No such institution is a real 404; a failed query is not.
  if (data.status === "missing") notFound();

  // The page sits inside the layout's `min-h-dvh` flex column; declaring a
  // second one here is what used to push the footer below the fold.
  const backToMap = (
    <Link
      href="/"
      className={buttonClasses({
        variant: "ghost",
        size: "sm",
        className: "-ml-4",
      })}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {t("institution_page.back_to_map")}
    </Link>
  );

  if (data.status === "error") {
    return (
      <PageShell width="content">
        <div role="alert">
          <EmptyState
            icon={<AlertTriangle className="h-10 w-10" aria-hidden="true" />}
            title={t("map_page.detail_error")}
            description={t("errors.generic_body")}
            action={
              <Link href="/" className={buttonClasses({ variant: "secondary" })}>
                {t("institution_page.back_to_map")}
              </Link>
            }
          />
        </div>
      </PageShell>
    );
  }

  const { institution, needs } = data;

  return (
    <PageShell width="content">
      <div className="space-y-6">
        {backToMap}

        <InstitutionDetailPanel institution={institution} showCloseButton={false} />

        <section className="pt-4">
          <SectionHeader title={t("institution_page.active_needs")} />
          {needs.length === 0 ? (
            <EmptyState
              icon={<PackageSearch className="h-10 w-10" aria-hidden="true" />}
              title={t("needs_page.empty")}
              action={
                <Link href="/doniraj" className={buttonClasses({ variant: "secondary" })}>
                  {t("needs_page.browse_needs")}
                </Link>
              }
            />
          ) : (
            <ul className="space-y-4">
              {needs.map((need) => (
                <li key={need.id}>
                  <NeedCard need={need} canPledge={viewerCanPledge} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  );
}
