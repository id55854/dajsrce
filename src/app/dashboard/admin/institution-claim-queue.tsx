"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BadgeCheck, Building2, Link2, ShieldQuestion } from "lucide-react";
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
  type BadgeTone,
} from "@/components/ui";
import { safeHttpUrl } from "@/components/RegistryRecord";
import { useLocale, useT } from "@/i18n/client";
import {
  CLAIM_NOTE_MAX_LENGTH,
  CLAIM_OUT_OF_BAND_NOTE_MAX_LENGTH,
  claimApprovalNote,
  claimChallengeState,
  claimReviewErrorMessageKey,
  sameEmailAddress,
  type ClaimChallengeState,
  type InstitutionClaimReviewItem,
} from "@/lib/institution-claims";

type Decision = "approve" | "reject";

type Pending = {
  claim: InstitutionClaimReviewItem;
  decision: Decision;
  /** The transaction refused this approval for an unconfirmed mailbox. */
  mailboxRefused?: boolean;
};

const CHALLENGE_BADGE: Record<ClaimChallengeState, { tone: BadgeTone; key: string }> = {
  verified: { tone: "success", key: "admin.claims_challenge_verified" },
  sent: { tone: "info", key: "admin.claims_challenge_sent" },
  expired: { tone: "warning", key: "admin.claims_challenge_expired" },
  not_sent: { tone: "neutral", key: "admin.claims_challenge_not_sent" },
  no_registry_email: { tone: "neutral", key: "admin.claims_challenge_unavailable" },
};

const LINK_CLASSES =
  "break-all font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

/**
 * An approval without a confirmed register mailbox must say how the reviewer
 * checked the applicant instead; approve_institution_claim_transaction
 * refuses it otherwise.
 */
function needsOutOfBandCheck(pending: Pending | null): boolean {
  return (
    pending?.decision === "approve" &&
    (!pending.claim.email_verified || pending.mailboxRefused === true)
  );
}

function formatWhen(value: string | null, locale: string, withTime: boolean): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "hr-HR", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "Europe/Zagreb",
  }).format(date);
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-tertiary sm:w-44">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}

export function InstitutionClaimQueue({
  claims,
  total,
  renderedAt,
}: {
  claims: InstitutionClaimReviewItem[];
  /** Every open claim, not just the ones on this page. */
  total: number;
  /** The server's clock at render time, so both renders agree on "expired". */
  renderedAt: number;
}) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const router = useRouter();

  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const outOfBand = needsOutOfBandCheck(pending);

  function openDecision(claim: InstitutionClaimReviewItem, decision: Decision) {
    setPending({ claim, decision });
    setNote("");
    setNoteError(null);
  }

  async function submitDecision() {
    if (!pending) return;
    const trimmed = note.trim();
    let payloadNote: string | null;
    if (pending.decision === "reject") {
      // A rejection the applicant cannot act on is not a review.
      if (trimmed.length === 0) {
        setNoteError(t("admin.claims_note_required"));
        return;
      }
      payloadNote = trimmed;
    } else if (needsOutOfBandCheck(pending)) {
      payloadNote = claimApprovalNote(false, trimmed);
      if (!payloadNote) {
        setNoteError(t("admin.claims_verification_required"));
        return;
      }
    } else {
      payloadNote = claimApprovalNote(true, trimmed);
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/institution-claims/${pending.claim.id}/review`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: pending.decision, note: payloadNote }),
      });
      const data = (await res.json().catch(() => ({}))) as { code?: string };
      if (!res.ok) {
        const messageKey = claimReviewErrorMessageKey(res.status, data.code);
        if (data.code === "mailbox_not_verified") {
          // The mailbox state changed since this page rendered: ask for the
          // description the transaction needs instead of failing again.
          setPending((current) => (current ? { ...current, mailboxRefused: true } : current));
          setNoteError(t(messageKey));
        }
        toast({
          tone: "error",
          title: t("admin.claims_failed_toast"),
          description: t(messageKey),
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
      toast({
        tone: "error",
        title: t("admin.claims_failed_toast"),
        description: t("admin.claims_error_unavailable"),
      });
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
        actions={<Badge tone={total > 0 ? "warning" : "neutral"}>{total}</Badge>}
      />

      {total > claims.length ? (
        <p className="mb-4 text-sm text-ink-secondary">
          {t("admin.claims_showing", { shown: claims.length, total })}
        </p>
      ) : null}

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
            const registryEmail = organisation?.registry_email ?? null;
            const emailMismatch =
              Boolean(registryEmail) && !sameEmailAddress(claim.contact_email, registryEmail);
            const challenge = claimChallengeState(claim, renderedAt);
            const challengeBadge = CHALLENGE_BADGE[challenge];
            const website = safeHttpUrl(organisation?.website ?? null);
            const validUntil =
              challenge === "sent"
                ? formatWhen(claim.email_challenge_expires_at, locale, true)
                : null;
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
                  {/* The only proof of control this queue can show is the
                      register's own mailbox; the applicant's account email is
                      unverified and never counts as evidence. */}
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Badge
                      tone={challengeBadge.tone}
                      icon={
                        challenge === "verified" ? (
                          <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : undefined
                      }
                    >
                      {t(challengeBadge.key)}
                    </Badge>
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
                  </DetailRow>
                  {organisation?.oib ? (
                    <DetailRow label={t("admin.claims_oib")}>
                      <span className="font-mono text-xs">{organisation.oib}</span>
                    </DetailRow>
                  ) : null}
                  {organisation?.registry_number ? (
                    <DetailRow label={t("admin.claims_registry_number")}>
                      <span className="font-mono text-xs">{organisation.registry_number}</span>
                    </DetailRow>
                  ) : null}
                  {organisation?.legal_form ? (
                    <DetailRow label={t("admin.claims_legal_form")}>
                      {organisation.legal_form}
                    </DetailRow>
                  ) : null}
                  <DetailRow label={t("admin.claims_registry_entry")}>
                    {organisation?.address ?? "—"}
                  </DetailRow>
                  {website ? (
                    <DetailRow label={t("admin.claims_website")}>
                      <a
                        href={website}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className={LINK_CLASSES}
                      >
                        {organisation?.website}
                      </a>
                    </DetailRow>
                  ) : null}
                  <DetailRow label={t("admin.claims_registry_email")}>
                    {registryEmail ? (
                      <span className="break-all">{registryEmail}</span>
                    ) : (
                      <span className="text-ink-secondary">
                        {t("admin.claims_registry_email_missing")}
                      </span>
                    )}
                  </DetailRow>
                  <DetailRow label={t("admin.claims_contact_email")}>
                    <span className="break-all">{claim.contact_email}</span>
                    {emailMismatch ? (
                      <Badge
                        tone="warning"
                        size="sm"
                        className="ml-2 align-middle"
                        icon={<AlertTriangle className="h-3 w-3" aria-hidden="true" />}
                      >
                        {t("admin.claims_email_mismatch")}
                      </Badge>
                    ) : null}
                  </DetailRow>
                  {validUntil ? (
                    <DetailRow label={t("admin.claims_challenge_sent")}>
                      <time
                        dateTime={claim.email_challenge_expires_at ?? undefined}
                        suppressHydrationWarning
                      >
                        {t("admin.claims_challenge_valid_until", { date: validUntil })}
                      </time>
                    </DetailRow>
                  ) : null}
                  <DetailRow label={t("admin.claims_applicant")}>
                    {claim.applicant.name ?? "—"}
                    {claim.applicant.email ? (
                      <span className="ml-2 break-all text-ink-secondary">
                        {claim.applicant.email} ({t("admin.claims_applicant_email_unverified")})
                      </span>
                    ) : null}
                  </DetailRow>
                  <DetailRow label={t("admin.claims_evidence")}>
                    <span className="whitespace-pre-wrap">{claim.evidence_note ?? "—"}</span>
                  </DetailRow>
                  <DetailRow label={t("admin.claims_submitted_on")}>
                    <time dateTime={claim.created_at} className="tabular-nums" suppressHydrationWarning>
                      {formatWhen(claim.created_at, locale, true) ?? claim.created_at}
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
          label={outOfBand ? t("admin.claims_verification_label") : t("admin.claims_note_label")}
          hint={outOfBand ? t("admin.claims_verification_hint") : t("admin.claims_note_hint")}
          required={pending?.decision === "reject" || outOfBand}
          requiredLabel={t("common.required")}
          error={noteError ?? undefined}
        >
          {(field) => (
            <Textarea
              {...field}
              rows={3}
              maxLength={outOfBand ? CLAIM_OUT_OF_BAND_NOTE_MAX_LENGTH : CLAIM_NOTE_MAX_LENGTH}
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
