import type { Metadata } from "next";
import { InstitutionDetailPanel } from "@/components/InstitutionDetailPanel";
import { NeedCard } from "@/components/NeedCard";
import type { Institution } from "@/lib/types";
import type { NeedCardNeed } from "@/components/NeedCard";
import { getLocalInstitutions, getLocalNeeds } from "@/lib/local-data";

async function getInstitution(
  id: string
): Promise<{ institution: Institution | null; needs: NeedCardNeed[] }> {
  try {
    const { createServerSupabaseClient } = await import(
      "@/lib/supabase/server"
    );
    const supabase = await createServerSupabaseClient();

    const { data: institution, error: instError } = await supabase
      .from("institutions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (!instError && institution) {
      const { data: needsRows } = await supabase
        .from("needs")
        .select(
          "*, institution:institutions(id, name, category, address, city)"
        )
        .eq("institution_id", id)
        .eq("is_fulfilled", false)
        .order("urgency", { ascending: false })
        .order("created_at", { ascending: false });

      return {
        institution: institution as Institution,
        needs: (needsRows ?? []) as NeedCardNeed[],
      };
    }
  } catch {
    // Fall back to local data
  }

  const institution =
    getLocalInstitutions().find((i) => i.id === id) ?? null;
  const needs = institution
    ? (getLocalNeeds().filter(
        (n) => n.institution_id === id
      ) as NeedCardNeed[])
    : [];
  return { institution, needs };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { institution } = await getInstitution(id);

  if (!institution) {
    return { title: "Ustanova | DajSrce" };
  }

  const desc =
    institution.description.length > 160
      ? `${institution.description.slice(0, 157)}…`
      : institution.description;

  return {
    title: `${institution.name} | DajSrce`,
    description: desc,
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
        <p className="text-center text-gray-600">
          Ustanova nije pronađena.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50/60 to-white px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-10">
        <InstitutionDetailPanel
          institution={institution}
          showCloseButton={false}
        />

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
