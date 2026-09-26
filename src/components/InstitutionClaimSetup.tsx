"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Loader2,
  Mail,
  MailCheck,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Input,
  Textarea,
  useToast,
} from "@/components/ui";
import { useT } from "@/i18n/client";
import { richText } from "@/i18n/rich-text";
import { PRIVACY_HREF } from "@/lib/auth/terms";
import {
  CLAIM_NOTE_MAX_LENGTH,
  CLAIM_SEARCH_MAX_LIMIT,
  CLAIM_SEARCH_MAX_QUERY_LENGTH,
  CLAIM_SEARCH_MIN_QUERY_LENGTH,
  claimErrorMessageKey,
  claimSearchErrorMessageKey,
  maskEmailAddress,
  type ClaimableAssociation,
  type OwnInstitutionClaim,
} from "@/lib/institution-claims";
import { ORGANISATION } from "@/lib/organisation";

const SEARCH_DEBOUNCE_MS = 300;
const CONTACT_EMAIL = ORGANISATION.contactEmail ?? "";
const TEXT_LINK_CLASSES =
  "font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

type Props = {
  /**
   * Promotes the profile to the unlinked `ngo` role. Called once, immediately
   * before the claim is submitted, so a failure leaves the account on the
   * setup screen rather than half-way through onboarding.
   */
  ensureNgoRole: () => Promise<void>;
  /** Called after an approved claim is detected, so the page can navigate. */
  onApproved?: () => void;
  /** Rendered just above the submit button, e.g. the terms statement. */
  consent?: ReactNode;
  /** Keeps the submit button disabled, e.g. until `consent` is given. */
  submitBlocked?: boolean;
};

/** What the claim POST answers with; only the fields this screen reads. */
type SubmittedClaim = {
  id?: string;
  organisation?: { registry_email?: string | null } | null;
};

type ChallengeOutcome =
  | { kind: "sent"; to: string | null }
  | { kind: "not_delivered"; to: string | null }
  | { kind: "failed"; messageKey: string };

/** ensureNgoRole() throws translation keys, Postgres errors or network errors. */
function roleErrorKey(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("auth.")) return error.message;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "P0001" || code === "42501") return "claims.error_account_ineligible";
  if (error instanceof TypeError) return "claims.error_network";
  return "claims.error_unavailable";
}

export function InstitutionClaimSetup({
  ensureNgoRole,
  onApproved,
  consent,
  submitBlocked = false,
}: Props) {
  const t = useT();
  const toast = useToast();

  const [loadingClaim, setLoadingClaim] = useState(true);
  const [claim, setClaim] = useState<OwnInstitutionClaim | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClaimableAssociation[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  // A failed search is its own state: "no association matches" would send
  // the applicant looking for a typo that isn't there.
  const [searchErrorKey, setSearchErrorKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<ClaimableAssociation | null>(null);

  const [contactEmail, setContactEmail] = useState("");
  const [emailErrorKey, setEmailErrorKey] = useState<string | null>(null);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  // The registry doesn't publish an email for every association, so the
  // mailbox challenge isn't always available. The explanation opens by
  // itself once, right after such a claim is submitted; afterwards it stays
  // one click away instead of reopening on every visit.
  const [noEmailDialogOpen, setNoEmailDialogOpen] = useState(false);

  const loadClaim = useCallback(async () => {
    try {
      const res = await fetch("/api/institution-claims", { credentials: "include" });
      if (!res.ok) {
        setClaim(null);
        return;
      }
      const data = (await res.json()) as { claim: OwnInstitutionClaim | null };
      setClaim(data.claim ?? null);
      if (data.claim?.status === "approved") onApproved?.();
    } catch {
      setClaim(null);
    } finally {
      setLoadingClaim(false);
    }
  }, [onApproved]);

  useEffect(() => {
    void loadClaim();
  }, [loadClaim]);

  // Debounced, aborted search so a fast typist never renders a stale page.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < CLAIM_SEARCH_MIN_QUERY_LENGTH) {
      setResults([]);
      setTruncated(false);
      setSearchErrorKey(null);
      setSearching(false);
      setSearched(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({
          q: trimmed,
          limit: String(CLAIM_SEARCH_MAX_LIMIT),
        });
        const res = await fetch(`/api/institution-claims/search?${params}`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setResults([]);
          setTruncated(false);
          setSearchErrorKey(claimSearchErrorMessageKey(res.status));
          return;
        }
        const data = (await res.json()) as {
          items?: ClaimableAssociation[];
          truncated?: boolean;
        };
        if (controller.signal.aborted) return;
        setResults(Array.isArray(data.items) ? data.items : []);
        setTruncated(data.truncated === true);
        setSearchErrorKey(null);
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setTruncated(false);
          setSearchErrorKey("claims.error_network");
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
          setSearched(true);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  function pick(entry: ClaimableAssociation) {
    setSelected(entry);
    setResults([]);
    setTruncated(false);
    setQuery("");
    setSearched(false);
    if (entry.registry_email && !contactEmail) setContactEmail(entry.registry_email);
  }

  /**
   * Ask the server to mail a confirmation link to the address the register
   * publishes. Used right after a claim is submitted and by the manual
   * "send (again)" button.
   */
  async function startMailboxChallenge(claimId: string): Promise<ChallengeOutcome> {
    try {
      const res = await fetch(`/api/institution-claims/${claimId}/verify-email`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        code?: string;
        email_sent?: boolean;
        claim?: { registry_email?: string | null; contact_email?: string | null } | null;
      };
      if (!res.ok) {
        return { kind: "failed", messageKey: claimErrorMessageKey(res.status, data.code) };
      }
      const to = maskEmailAddress(data.claim?.registry_email ?? data.claim?.contact_email);
      return data.email_sent ? { kind: "sent", to } : { kind: "not_delivered", to };
    } catch {
      return { kind: "failed", messageKey: "claims.error_network" };
    }
  }

  async function submitClaim() {
    if (!selected || submitBlocked) return;
    const email = contactEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setEmailErrorKey("claims.contact_email_invalid");
      return;
    }
    setEmailErrorKey(null);
    setSubmitting(true);
    try {
      try {
        await ensureNgoRole();
      } catch (error) {
        toast({
          tone: "error",
          title: t("claims.failed_toast"),
          description: t(roleErrorKey(error)),
        });
        return;
      }

      const res = await fetch("/api/institution-claims", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          udr_id: selected.id,
          contact_email: email,
          evidence_note: evidenceNote.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        claim?: SubmittedClaim;
        code?: string;
      };
      if (!res.ok) {
        toast({
          tone: "error",
          title: t("claims.failed_toast"),
          description: t(claimErrorMessageKey(res.status, data.code), { email: CONTACT_EMAIL }),
        });
        return;
      }

      const registryEmail = data.claim?.organisation?.registry_email ?? selected.registry_email;
      setSelected(null);
      setEvidenceNote("");

      if (data.claim?.id && registryEmail) {
        // Most applicants stop after "submit", so the mailbox challenge
        // starts by itself whenever the register publishes an address; the
        // pending card keeps a manual "send again".
        const outcome = await startMailboxChallenge(data.claim.id);
        toast(
          outcome.kind === "sent"
            ? {
                tone: "success",
                title: t("claims.submitted_toast_title"),
                description: t("claims.submitted_challenge_sent", {
                  email: outcome.to ?? maskEmailAddress(registryEmail) ?? "",
                }),
              }
            : {
                tone: "warning",
                title: t("claims.submitted_toast_title"),
                description: t("claims.submitted_challenge_failed"),
              }
        );
      } else {
        toast({
          tone: "success",
          title: t("claims.submitted_toast_title"),
          description: t("claims.submitted_toast_body"),
        });
        if (!registryEmail) setNoEmailDialogOpen(true);
      }
      await loadClaim();
    } catch {
      toast({
        tone: "error",
        title: t("claims.failed_toast"),
        description: t("claims.error_network"),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function sendVerificationEmail() {
    if (!claim) return;
    setVerifying(true);
    try {
      const outcome = await startMailboxChallenge(claim.id);
      if (outcome.kind === "failed") {
        toast({
          tone: "error",
          title: t("claims.email_verify_failed"),
          description: t(outcome.messageKey, { email: CONTACT_EMAIL }),
        });
        return;
      }
      toast(
        outcome.kind === "sent"
          ? {
              tone: "success",
              title: t("claims.email_verify_sent"),
              description: outcome.to ?? undefined,
            }
          : {
              tone: "warning",
              title: t("claims.email_verify_not_delivered"),
              description: t("claims.email_verify_not_delivered_body", { email: CONTACT_EMAIL }),
            }
      );
      await loadClaim();
    } finally {
      setVerifying(false);
    }
  }

  async function withdrawClaim() {
    if (!claim) return;
    setWithdrawing(true);
    try {
      const res = await fetch(`/api/institution-claims/${claim.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { code?: string };
        toast({
          tone: "error",
          title: t("claims.withdraw_failed"),
          description: t(claimErrorMessageKey(res.status, data.code), { email: CONTACT_EMAIL }),
        });
        return;
      }
      toast({ tone: "success", title: t("claims.withdrawn_toast") });
      await loadClaim();
    } catch {
      toast({
        tone: "error",
        title: t("claims.withdraw_failed"),
        description: t("claims.error_network"),
      });
    } finally {
      setWithdrawing(false);
    }
  }

  const contactLink = CONTACT_EMAIL ? (
    <a href={`mailto:${CONTACT_EMAIL}`} className={TEXT_LINK_CLASSES}>
      {CONTACT_EMAIL}
    </a>
  ) : null;

  const noEmailDialog = (
    <Dialog
      open={noEmailDialogOpen}
      onClose={() => setNoEmailDialogOpen(false)}
      title={t("claims.no_registry_email_dialog_title")}
      closeLabel={t("common.close")}
      footer={
        <Button
          onClick={() => setNoEmailDialogOpen(false)}
          data-dialog-initial-focus
        >
          {t("claims.no_registry_email_dialog_ok")}
        </Button>
      }
    >
      <p className="text-sm leading-6 text-ink-secondary">
        {t("claims.no_registry_email_dialog_body")}{" "}
        {contactLink ? <>{contactLink}.</> : null}
      </p>
    </Dialog>
  );

  if (loadingClaim) {
    return (
      <p role="status" className="inline-flex items-center gap-2 text-sm text-ink-secondary">
        <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden="true" />
        {t("claims.loading")}
      </p>
    );
  }

  const isOpen = claim?.status === "pending" || claim?.status === "email_sent";

  if (claim && isOpen) {
    const registryEmail = claim.organisation?.registry_email ?? null;
    const maskedRegistryEmail = maskEmailAddress(registryEmail);
    return (
      <>
        <Card padding="lg" className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                {t("claims.status_title")}
              </p>
              <h2 className="mt-1 flex items-center gap-2 text-base font-semibold text-ink">
                <Building2 className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                <span className="min-w-0 break-words">
                  {claim.organisation?.name ?? claim.udr_id}
                </span>
              </h2>
            </div>
            <Badge tone={claim.email_verified ? "success" : "warning"}>
              {claim.email_verified
                ? t("claims.email_verified_badge")
                : t("claims.status_pending")}
            </Badge>
          </div>

          <p className="text-sm leading-6 text-ink-secondary">{t("claims.status_pending_body")}</p>

          <dl className="space-y-1 rounded-control border border-border-subtle bg-surface-sunken p-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <dt className="text-ink-tertiary">{t("claims.contact_email_label")}</dt>
              <dd className="min-w-0 break-all text-ink">{claim.contact_email}</dd>
            </div>
          </dl>

          {/* Where the confirmation link goes (or went): always the address
              the register publishes, shown masked. */}
          {!claim.email_verified && maskedRegistryEmail ? (
            <p className="text-sm leading-6 text-ink-secondary">
              {claim.email_challenge_sent
                ? t("claims.email_challenge_sent_to", { email: maskedRegistryEmail })
                : t("claims.email_challenge_will_send", { email: maskedRegistryEmail })}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {claim.email_verified ? (
              <span className="inline-flex items-center gap-2 text-sm font-medium text-success">
                <MailCheck className="h-4 w-4" aria-hidden="true" />
                {t("claims.email_verified_badge")}
              </span>
            ) : registryEmail ? (
              <Button
                variant="secondary"
                onClick={() => void sendVerificationEmail()}
                loading={verifying}
                icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
              >
                {claim.email_challenge_sent
                  ? t("claims.email_verify_resend")
                  : t("claims.email_verify_cta")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setNoEmailDialogOpen(true)}
                icon={<Mail className="h-4 w-4" aria-hidden="true" />}
              >
                {t("claims.email_verify_unavailable_cta")}
              </Button>
            )}
            <Button variant="ghost" onClick={() => void withdrawClaim()} loading={withdrawing}>
              {t("claims.withdraw")}
            </Button>
          </div>
        </Card>
        {noEmailDialog}
      </>
    );
  }

  return (
    <>
    <div className="space-y-4">
      {claim?.status === "rejected" ? (
        <Card padding="lg" className="border-danger/30">
          <p className="flex items-center gap-2 text-sm font-semibold text-danger">
            <XCircle className="h-4 w-4" aria-hidden="true" />
            {t("claims.status_rejected")}
          </p>
          {claim.review_note ? (
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{claim.review_note}</p>
          ) : null}
          <p className="mt-2 text-sm leading-6 text-ink-secondary">
            {t("claims.status_rejected_body")}
          </p>
        </Card>
      ) : null}

      <p className="text-sm leading-6 text-ink-secondary">{t("claims.setup_intro")}</p>

      {selected ? (
        <Card padding="md" className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                <span className="min-w-0 break-words">{selected.name}</span>
              </p>
              <p className="mt-1 text-sm text-ink-secondary">
                {[selected.address, selected.city, selected.county].filter(Boolean).join(", ")}
              </p>
              <p className="mt-1 font-mono text-xs text-ink-tertiary">{selected.id}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              {t("claims.change_selection")}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Field
            label={t("claims.search_label")}
            hint={t("claims.search_hint")}
          >
            {(field) => (
              <Input
                {...field}
                interactive
                type="search"
                autoComplete="organization"
                maxLength={CLAIM_SEARCH_MAX_QUERY_LENGTH}
                placeholder={t("claims.search_placeholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
          </Field>

          {searching ? (
            <p role="status" className="inline-flex items-center gap-2 text-sm text-ink-secondary">
              <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden="true" />
              {t("claims.searching")}
            </p>
          ) : null}

          {!searching && searchErrorKey ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger-on-soft"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
              <span className="min-w-0">{t(searchErrorKey)}</span>
            </p>
          ) : null}

          {!searching && searched && !searchErrorKey && results.length === 0 ? (
            <div role="status" className="space-y-1 text-sm leading-6 text-ink-secondary">
              <p className="inline-flex items-center gap-2 font-medium text-ink">
                <Search className="h-4 w-4" aria-hidden="true" />
                {t("claims.search_empty")}
              </p>
              <p>{richText(t("claims.search_empty_next"), { email: contactLink ?? CONTACT_EMAIL })}</p>
            </div>
          ) : null}

          {truncated && results.length > 0 ? (
            <p className="text-sm text-ink-secondary">
              {t("claims.search_truncated", { count: results.length })}
            </p>
          ) : null}

          {results.length > 0 ? (
            <ul className="space-y-2">
              {results.map((entry) => {
                const place = [entry.address, entry.city, entry.county]
                  .filter(Boolean)
                  .join(", ");
                if (entry.claim_state === "available") {
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => pick(entry)}
                        className="w-full rounded-control border border-border-subtle bg-surface-raised px-4 py-3 text-left transition-[border-color,background-color,transform] duration-150 ease-out hover:border-border-strong hover:bg-surface-sunken motion-safe:active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                      >
                        <span className="block break-words font-medium text-ink">
                          {entry.name}
                        </span>
                        <span className="mt-0.5 block text-sm text-ink-secondary">{place}</span>
                      </button>
                    </li>
                  );
                }
                // Not a disabled button: a disabled control cannot be focused
                // or explained, and this row has to say what to do next.
                const linked = entry.claim_state === "linked";
                return (
                  <li
                    key={entry.id}
                    className="rounded-control border border-border-subtle bg-surface-sunken px-4 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-words font-medium text-ink-secondary">{entry.name}</p>
                        <p className="mt-0.5 text-sm text-ink-tertiary">{place}</p>
                      </div>
                      <Badge tone="neutral" size="sm">
                        {linked ? t("claims.state_linked") : t("claims.state_claimed")}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-ink-secondary">
                      {richText(
                        t(linked ? "claims.state_linked_help" : "claims.state_claimed_help"),
                        { email: contactLink ?? CONTACT_EMAIL }
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </>
      )}

      {selected ? (
        <>
          <Field
            label={t("claims.contact_email_label")}
            hint={t("claims.contact_email_hint")}
            required
            requiredLabel={t("common.required")}
            error={emailErrorKey ? t(emailErrorKey) : undefined}
          >
            {(field) => (
              <Input
                {...field}
                type="email"
                autoComplete="email"
                required
                invalid={Boolean(emailErrorKey)}
                value={contactEmail}
                onChange={(e) => {
                  setContactEmail(e.target.value);
                  setEmailErrorKey(null);
                }}
              />
            )}
          </Field>

          <div className="space-y-1.5">
            <Field label={t("claims.evidence_label")} hint={t("claims.evidence_hint")}>
              {(field) => (
                <Textarea
                  {...field}
                  rows={3}
                  maxLength={CLAIM_NOTE_MAX_LENGTH}
                  value={evidenceNote}
                  onChange={(e) => setEvidenceNote(e.target.value)}
                />
              )}
            </Field>
            <p className="text-sm text-ink-tertiary">
              {richText(t("claims.evidence_privacy"), {
                privacy: (
                  <a
                    href={PRIVACY_HREF}
                    target="_blank"
                    rel="noopener"
                    className={TEXT_LINK_CLASSES}
                  >
                    {t("claims.evidence_privacy_link")}
                  </a>
                ),
              })}
            </p>
          </div>

          {consent}

          <Button
            size="lg"
            fullWidth
            loading={submitting}
            disabled={submitBlocked}
            onClick={() => void submitClaim()}
          >
            {t("claims.submit")}
          </Button>
        </>
      ) : null}
    </div>
    {noEmailDialog}
    </>
  );
}
