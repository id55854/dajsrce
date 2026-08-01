import type { Metadata } from "next";
import { cache } from "react";
import { InstitutionDetailPanel } from "@/components/InstitutionDetailPanel";
import { NeedCard, type NeedCardNeed } from "@/components/NeedCard";
import { createPublicSupabaseClient } from "@/lib/supabase/public";
import { trustStatus, type PublicInstitutionDetail } from "@/lib/location-map";
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

const getInstitution = cache(
  async (
    id: string
  ): Promise<{ institution: PublicInstitutionDetail | null; needs: NeedCardNeed[] }> => {
    try {
      const supabase = createPublicSupabaseClient();
      const { data, error } = await supabase.rpc("public_institution_detail_v1", {
        p_id: id,
      });
      if (error) throw new Error(`Institution detail query failed (${error.code})`);

      const row = ((data ?? []) as DetailRpcRow[])[0];
      if (!row) return { institution: null, needs: [] };
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
        institution,
        needs: (needRows ?? []).map((need) => ({
          ...need,
          institution: needInstitution,
        })) as NeedCardNeed[],
      };
    } catch (error) {
      console.error("institution_public_page_query_failed", {
        institutionId: id,
        message: error instanceof Error ? error.message : "unknown",
      });
      return { institution: null, needs: [] };
    }
  }
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { institution } = await getInstitution(id);

  if (!institution) return { title: "Ustanova | DajSrce" };

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
  const { institution, needs } = await getInstitution(id);

  if (!institution) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-red-50/60 to-white px-4">
        <p className="text-center text-gray-600">Ustanova nije pronađena.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50/60 to-white px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-10">
        <InstitutionDetailPanel institution={institution} showCloseButton={false} />

        <section>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Aktivne potrebe
          </h2>
          {needs.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-200 bg-white/80 px-6 py-10 text-center text-sm text-gray-600">
              Trenutačno nema aktivnih potreba.
            </p>
          ) : (
            <ul className="space-y-4">
              {needs.map((need) => (
                <li key={need.id}>
                  <NeedCard need={need} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
