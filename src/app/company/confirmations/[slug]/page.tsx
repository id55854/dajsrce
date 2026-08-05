import { notFound, redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizeRole } from "@/lib/auth/roles";
import { PrintConfirmationButton } from "@/components/PrintConfirmationButton";
import { Badge, Card, PageHeader, PageShell } from "@/components/ui";

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
    <PageShell width="content">
      <PageHeader
        eyebrow="DajSrce"
        title="Legacy support record"
        subtitle="Historical company-submitted support entry."
        actions={<PrintConfirmationButton />}
      />

      <Card padding="lg" className="print:border-0 print:shadow-none">
        <Badge tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}>
          Self-reported — not independently verified
        </Badge>

        <dl className="mt-6 grid gap-5 sm:grid-cols-2">
          <Data label="Company" value={action.company_name} />
          <Data label="NGO" value={action.ngo_name} />
          <Data label="Donation/support type" value={action.support_type} />
          <Data label="Date" value={new Date(action.created_at).toLocaleDateString()} />
          <Data label="Delivery method" value={action.shipment_method} />
        </dl>

        {action.note ? (
          <div className="mt-6 rounded-control bg-surface-sunken p-4 text-sm leading-6 text-ink">
            {action.note}
          </div>
        ) : null}

        <p className="mt-8 border-t border-border-subtle pt-6 text-sm leading-6 text-ink-tertiary">
          This legacy record was entered by the company and was not acknowledged by the named
          NGO. It is not a donation receipt, tax document, or independently verified evidence.
          Use acknowledged pledges and generated receipts for formal reporting.
        </p>
      </Card>
    </PageShell>
  );
}

function Data({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-ink">{value ?? "—"}</dd>
    </div>
  );
}
