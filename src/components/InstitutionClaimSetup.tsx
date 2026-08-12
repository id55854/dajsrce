"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Loader2,
  MailCheck,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Textarea,
  useToast,
} from "@/components/ui";
import { useT } from "@/i18n/client";
import {
  CLAIM_SEARCH_MIN_QUERY_LENGTH,
  type ClaimableAssociation,
  type OwnInstitutionClaim,
} from "@/lib/institution-claims";

const SEARCH_DEBOUNCE_MS = 300;

type Props = {
  /**
   * Promotes the profile to the unlinked `ngo` role. Called once, immediately
   * before the claim is submitted, so a failure leaves the account on the
   * setup screen rather than half-way through onboarding.
   */
  ensureNgoRole: () => Promise<void>;
  /** Called after an approved claim is detected, so the page can navigate. */
  onApproved?: () => void;
};

export function InstitutionClaimSetup({ ensureNgoRole, onApproved }: Props) {
  const t = useT();
  const toast = useToast();

  const [loadingClaim, setLoadingClaim] = useState(true);
  const [claim, setClaim] = useState<OwnInstitutionClaim | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClaimableAssociation[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<ClaimableAssociation | null>(null);

  const [contactEmail, setContactEmail] = useState("");
  const [emailErrorKey, setEmailErrorKey] = useState<string | null>(null);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

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

  // The confirmation link lands here rather than on a bare confirmation page,
  // so the applicant sees the claim state immediately after proving the
  // mailbox. The raw token is removed from the address bar once consumed.
  const tokenHandled = useRef(false);
  useEffect(() => {
    if (tokenHandled.current || typeof window === "undefined") return;
    const token = new URLSearchParams(window.location.search).get("claim_token");
    if (!token) return;
    tokenHandled.current = true;

    void (async () => {
      try {
        const res = await fetch("/api/institution-claims/confirm", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        toast(
          res.ok
            ? { tone: "success", title: t("claims.email_confirmed_toast") }
            : { tone: "error", title: t("claims.email_confirm_failed") }
        );
      } catch {
        toast({ tone: "error", title: t("claims.email_confirm_failed") });
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete("claim_token");
        window.history.replaceState(null, "", url.toString());
        await loadClaim();
      }
    })();
  }, [loadClaim, t, toast]);

  // Debounced, aborted search so a fast typist never renders a stale page.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < CLAIM_SEARCH_MIN_QUERY_LENGTH) {
      setResults([]);
      setSearched(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/institution-claims/search?q=${encodeURIComponent(trimmed)}`,
          { credentials: "include", signal: controller.signal }
        );
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = (await res.json()) as { items: ClaimableAssociation[] };
        setResults(Array.isArray(data.items) ? data.items : []);
      } catch {
        if (!controller.signal.aborted) setResults([]);
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
    setQuery("");
    setSearched(false);
    if (entry.registry_email && !contactEmail) setContactEmail(entry.registry_email);
  }

  async function submitClaim() {
    if (!selected) return;
    const email = contactEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setEmailErrorKey("claims.contact_email_invalid");
      return;
    }
    setEmailErrorKey(null);
    setSubmitting(true);
    try {
      await ensureNgoRole();
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
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({
          tone: "error",
          title: t("claims.failed_toast"),
          description: typeof data.error === "string" ? data.error : undefined,
        });
        return;
      }
      toast({
        tone: "success",
        title: t("claims.submitted_toast_title"),
        description: t("claims.submitted_toast_body"),
      });
      setSelected(null);
      setEvidenceNote("");
      await loadClaim();
    } catch {
      toast({ tone: "error", title: t("claims.failed_toast") });
    } finally {
      setSubmitting(false);
    }
  }

  async function sendVerificationEmail() {
    if (!claim) return;
    setVerifying(true);
    try {
      const res = await fetch(`/api/institution-claims/${claim.id}/verify-email`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        email_sent?: boolean;
      };
      if (!res.ok) {
        toast({
          tone: "error",
          title: t("claims.email_verify_failed"),
          description: typeof data.error === "string" ? data.error : undefined,
        });
        return;
      }
      toast({
        tone: data.email_sent ? "success" : "warning",
        title: data.email_sent
          ? t("claims.email_verify_sent")
          : t("claims.email_verify_not_delivered"),
      });
      await loadClaim();
    } catch {
      toast({ tone: "error", title: t("claims.email_verify_failed") });
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
        toast({ tone: "error", title: t("claims.withdraw_failed") });
        return;
      }
      toast({ tone: "success", title: t("claims.withdrawn_toast") });
      await loadClaim();
    } catch {
      toast({ tone: "error", title: t("claims.withdraw_failed") });
    } finally {
      setWithdrawing(false);
    }
  }

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
    return (
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
          {claim.organisation?.registry_email ? (
            <div className="flex flex-wrap gap-2">
              <dt className="text-ink-tertiary">{t("claims.registry_email_label")}</dt>
              <dd className="min-w-0 break-all text-ink">{claim.organisation.registry_email}</dd>
            </div>
          ) : null}
        </dl>

        <div className="flex flex-wrap gap-2">
          {claim.email_verified ? (
            <span className="inline-flex items-center gap-2 text-sm font-medium text-success">
              <MailCheck className="h-4 w-4" aria-hidden="true" />
              {t("claims.email_verified_badge")}
            </span>
          ) : claim.organisation?.registry_email ? (
            <Button
              variant="secondary"
              onClick={() => void sendVerificationEmail()}
              loading={verifying}
              icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
            >
              {t("claims.email_verify_cta")}
            </Button>
          ) : (
            <p className="text-sm text-ink-tertiary">{t("claims.email_verify_unavailable")}</p>
          )}
          <Button variant="ghost" onClick={() => void withdrawClaim()} loading={withdrawing}>
            {t("claims.withdraw")}
          </Button>
        </div>
      </Card>
    );
  }

  return (
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
                type="search"
                autoComplete="organization"
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

          {!searching && searched && results.length === 0 ? (
            <p className="inline-flex items-center gap-2 text-sm text-ink-secondary">
              <Search className="h-4 w-4" aria-hidden="true" />
              {t("claims.search_empty")}
            </p>
          ) : null}

          {results.length > 0 ? (
            <ul className="space-y-2">
              {results.map((entry) => {
                const claimable = entry.claim_state === "available";
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      disabled={!claimable}
                      onClick={() => pick(entry)}
                      className="w-full rounded-control border border-border-subtle bg-surface-raised px-4 py-3 text-left transition-[border-color,background-color,transform] duration-150 ease-out hover:border-border-strong hover:bg-surface-sunken motion-safe:active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="flex flex-wrap items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block break-words font-medium text-ink">
                            {entry.name}
                          </span>
                          <span className="mt-0.5 block text-sm text-ink-secondary">
                            {[entry.address, entry.city, entry.county]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        </span>
                        {claimable ? null : (
                          <Badge tone="neutral" size="sm">
                            {entry.claim_state === "linked"
                              ? t("claims.state_linked")
                              : t("claims.state_claimed")}
                          </Badge>
                        )}
                      </span>
                    </button>
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

          <Field label={t("claims.evidence_label")} hint={t("claims.evidence_hint")}>
            {(field) => (
              <Textarea
                {...field}
                rows={3}
                maxLength={2000}
                value={evidenceNote}
                onChange={(e) => setEvidenceNote(e.target.value)}
              />
            )}
          </Field>

          <Button
            size="lg"
            fullWidth
            loading={submitting}
            onClick={() => void submitClaim()}
          >
            {t("claims.submit")}
          </Button>
        </>
      ) : null}
    </div>
  );
}
