"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Building2, Link2, MailCheck, MailQuestion, ShieldQuestion } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  SectionHeader,
  Textarea,
  useToast,
} from "@/components/ui";
import { useT } from "@/i18n/client";
import type { InstitutionClaimReviewItem } from "@/lib/institution-claims";

type Decision = "approve" | "reject";

type Pending = { claim: InstitutionClaimReviewItem; decision: Decision };

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-tertiary sm:w-40">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}

export function InstitutionClaimQueue({ claims }: { claims: InstitutionClaimReviewItem[] }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function openDecision(claim: InstitutionClaimReviewItem, decision: Decision) {
    setPending({ claim, decision });
    setNote("");
    setNoteError(null);
  }

  async function submitDecision() {
    if (!pending) return;
    const trimmed = note.trim();
    // A rejection the applicant cannot act on is not a review.
    if (pending.decision === "reject" && trimmed.length === 0) {
      setNoteError(t("admin.claims_note_required"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/institution-claims/${pending.claim.id}/review`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: pending.decision, note: trimmed || null }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({
          tone: "error",
          title: t("admin.claims_failed_toast"),
          description: typeof data.error === "string" ? data.error : undefined,
        });
        return;
      }
      toast({
        tone: "success",
        title:
          pending.decision === "approve"
            ? t("admin.claims_approved_toast")
            : t("admin.claims_rejected_toast"),
        description: pending.claim.organisation?.name ?? pending.claim.udr_id,
      });
      setPending(null);
      router.refresh();
    } catch {
      toast({ tone: "error", title: t("admin.claims_failed_toast") });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="institution-claims-heading" className="mt-8">
      <SectionHeader
        id="institution-claims-heading"
        title={t("admin.claims_title")}
        description={t("admin.claims_subtitle")}
        actions={<Badge tone={claims.length > 0 ? "warning" : "neutral"}>{claims.length}</Badge>}
      />

      {claims.length === 0 ? (
        <EmptyState
          icon={<ShieldQuestion className="h-8 w-8" strokeWidth={1.5} aria-hidden="true" />}
          title={t("admin.claims_empty_title")}
          description={t("admin.claims_empty_body")}
        />
      ) : (
        <ul className="space-y-4">
          {claims.map((claim) => {
            const organisation = claim.organisation;
            return (
              <Card as="li" key={claim.id} padding="lg">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
                      <Building2 className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                      <span className="min-w-0 break-words">
                        {organisation?.name ?? t("admin.claims_registry_missing")}
                      </span>
                    </h3>
                    <p className="mt-1 text-sm text-ink-secondary">
                      {[organisation?.city, organisation?.county].filter(Boolean).join(", ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {claim.email_verified ? (
                      <Badge
                        tone="success"
                        icon={<MailCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                      >
                        {t("admin.claims_email_verified")}
                      </Badge>
                    ) : claim.email_challenge_sent ? (
                      <Badge
                        tone="info"
                        icon={<MailQuestion className="h-3.5 w-3.5" aria-hidden="true" />}
                      >
                        {t("admin.claims_email_pending")}
                      </Badge>
                    ) : (
                      <Badge
                        tone="warning"
                        icon={<MailQuestion className="h-3.5 w-3.5" aria-hidden="true" />}
                      >
                        {t("admin.claims_email_unverified")}
                      </Badge>
                    )}
                    {organisation?.already_linked ? (
                      <Badge
                        tone="danger"
                        icon={<Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
                      >
                        {t("admin.claims_already_linked")}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <dl className="space-y-2 rounded-control border border-border-subtle bg-surface-sunken p-4">
                  <DetailRow label={t("admin.claims_udr")}>
                    <span className="font-mono text-xs">{claim.udr_id}</span>
                    {organisation?.registry_number ? (
                      <span className="ml-2 font-mono text-xs text-ink-tertiary">
                        {organisation.registry_number}
                      </span>
                    ) : null}
                  </DetailRow>
                  <DetailRow label={t("admin.claims_registry_entry")}>
                    {organisation?.address ?? "—"}
                  </DetailRow>
                  <DetailRow label={t("admin.claims_applicant")}>
                    {claim.applicant.name ?? "—"}
                    {claim.applicant.email ? (
                      <span className="ml-2 text-ink-secondary">{claim.applicant.email}</span>
                    ) : null}
                  </DetailRow>
                  <DetailRow label={t("admin.claims_contact_email")}>
                    <span className="break-all">{claim.contact_email}</span>
                    {organisation?.registry_email ? (
                      <span className="ml-2 break-all text-ink-tertiary">
                        ({organisation.registry_email})
                      </span>
                    ) : null}
                  </DetailRow>
                  <DetailRow label={t("admin.claims_evidence")}>
                    {claim.evidence_note ?? "—"}
                  </DetailRow>
                  <DetailRow label={t("admin.claims_submitted_on")}>
                    <time dateTime={claim.created_at} className="tabular-nums">
                      {new Date(claim.created_at).toISOString().slice(0, 10)}
                    </time>
                  </DetailRow>
                </dl>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    onClick={() => openDecision(claim, "approve")}
                    icon={<BadgeCheck className="h-4 w-4" aria-hidden="true" />}
                  >
                    {t("admin.claims_approve")}
                  </Button>
                  <Button variant="secondary" onClick={() => openDecision(claim, "reject")}>
                    {t("admin.claims_reject")}
                  </Button>
                </div>
              </Card>
            );
          })}
        </ul>
      )}

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={
          pending?.decision === "approve"
            ? t("admin.claims_review_approve_title")
            : t("admin.claims_review_reject_title")
        }
        description={pending?.claim.organisation?.name ?? pending?.claim.udr_id}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button
              variant={pending?.decision === "approve" ? "primary" : "danger"}
              onClick={() => void submitDecision()}
              loading={submitting}
              data-dialog-initial-focus
            >
              {pending?.decision === "approve"
                ? t("admin.claims_approve")
                : t("admin.claims_reject")}
            </Button>
            <Button variant="secondary" onClick={() => setPending(null)}>
              {t("common.cancel")}
            </Button>
          </>
        }
      >
        <Field
          label={t("admin.claims_note_label")}
          hint={t("admin.claims_note_hint")}
          required={pending?.decision === "reject"}
          requiredLabel={t("common.required")}
          error={noteError ?? undefined}
        >
          {(field) => (
            <Textarea
              {...field}
              rows={3}
              value={note}
              invalid={Boolean(noteError)}
              onChange={(e) => {
                setNote(e.target.value);
                setNoteError(null);
              }}
            />
          )}
        </Field>
      </Dialog>
    </section>
  );
}
