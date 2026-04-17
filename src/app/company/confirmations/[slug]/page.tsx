import { notFound, redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizeRole } from "@/lib/auth/roles";
import { PrintConfirmationButton } from "@/components/PrintConfirmationButton";

export default async function CompanyConfirmationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth/login?next=${encodeURIComponent(`/company/confirmations/${slug}`)}`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (normalizeRole(profile?.role) !== "company") {
    redirect("/dashboard");
  }

  const { data: action } = await supabase
    .from("company_actions")
    .select("*")
    .eq("company_profile_id", user.id)
    .eq("confirmation_slug", slug)
    .maybeSingle();

  if (!action) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Thank-you Confirmation
        </h1>
        <PrintConfirmationButton />
      </div>
      <article className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900 print:shadow-none">
        <p className="text-xs uppercase tracking-[0.2em] text-gray-500">
          DajSrce • Corporate Support Confirmation
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-gray-900 dark:text-gray-100">
          Thank you for supporting the community
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Data label="Company" value={action.company_name} />
          <Data label="NGO" value={action.ngo_name} />
          <Data label="Donation/support type" value={action.support_type} />
          <Data label="Date" value={new Date(action.created_at).toLocaleDateString()} />
          <Data label="Status" value={action.status} />
          <Data label="Delivery method" value={action.shipment_method} />
        </div>
        {action.note ? (
          <div className="mt-6 rounded-xl bg-gray-50 p-4 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200">
            {action.note}
          </div>
        ) : null}
        <p className="mt-8 text-xs text-gray-500">
          This printable confirmation is generated for CSR/impact record keeping.
        </p>
      </article>
    </div>
  );
}

function Data({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
        {value}
      </p>
    </div>
  );
}
