"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Inbox, ShieldCheck } from "lucide-react";
import { DONATION_TYPES } from "@/lib/constants";
import type { DonationType } from "@/lib/types";
import {
  OFFER_CITY_MAX_LENGTH,
  OFFER_CLAIM_MESSAGE_MAX_LENGTH,
  OFFER_QUERY_MAX_LENGTH,
  type InstitutionOfferClaim,
  type OfferBrowseItem,
} from "@/lib/offers";
import { createClient } from "@/lib/supabase/client";
import { useLocale, useT } from "@/i18n/client";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PageShell,
  Select,
  SectionHeader,
  Skeleton,
  SkeletonText,
  Textarea,
  buttonClasses,
  useToast,
} from "@/components/ui";
import { OfferCard } from "@/components/OfferCard";

const DONATION_KEYS = Object.keys(DONATION_TYPES) as DonationType[];

const CLAIM_STATUS_KEY: Record<InstitutionOfferClaim["status"], string> = {
  requested: "offers.claim_status_requested",
  accepted: "offers.claim_status_accepted",
  declined: "offers.claim_status_declined",
  withdrawn: "offers.claim_status_withdrawn",
};

type Filters = { donationType: DonationType | "all"; city: string; query: string };

const EMPTY_FILTERS: Filters = { donationType: "all", city: "", query: "" };

function OfferSkeleton() {
  return (
    <Card>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-28 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-6 w-3/4" />
      <SkeletonText className="mt-3" lines={3} />
      <Skeleton className="mt-5 h-11 w-40 rounded-full" />
    </Card>
  );
}

/**
 * The organisation side of the offer flow.
 *
 * Nothing here decides whether the caller may see an offer — the list endpoint
 * refuses with 403 unless the signed-in profile belongs to a verified
 * institution, and this component simply renders that refusal. Registry
 * presence alone never opens the list.
 */
export function OffersInboxClient() {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();

  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const [offers, setOffers] = useState<OfferBrowseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [claims, setClaims] = useState<InstitutionOfferClaim[]>([]);

  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [reload, setReload] = useState(0);

  const [claimTarget, setClaimTarget] = useState<OfferBrowseItem | null>(null);
  const [claimMessage, setClaimMessage] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [pendingClaimId, setPendingClaimId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFailed(false);
      setForbidden(false);
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!user) {
          setLoggedIn(false);
          setLoading(false);
          return;
        }
        setLoggedIn(true);

        const params = new URLSearchParams({ scope: "open" });
        if (applied.donationType !== "all") {
          params.set("donationType", applied.donationType);
        }
        if (applied.city.trim()) params.set("city", applied.city.trim());
        if (applied.query.trim().length >= 2) params.set("q", applied.query.trim());

        const [browseResponse, claimsResponse] = await Promise.all([
          fetch(`/api/offers?${params.toString()}`, { credentials: "include" }),
          fetch("/api/offers?scope=inbox", { credentials: "include" }),
        ]);

        if (browseResponse.status === 403 || claimsResponse.status === 403) {
          if (!cancelled) setForbidden(true);
          return;
        }
        if (!browseResponse.ok || !claimsResponse.ok) throw new Error("unavailable");

        const browse = (await browseResponse.json()) as {
          items?: OfferBrowseItem[];
          meta?: { total?: number };
        };
        const inbox = (await claimsResponse.json()) as {
          items?: InstitutionOfferClaim[];
        };
        if (cancelled) return;
        setOffers(browse.items ?? []);
        setTotal(browse.meta?.total ?? 0);
        setClaims(inbox.items ?? []);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applied, reload]);

  const sendClaim = useCallback(async () => {
    if (!claimTarget) return;
    setClaiming(true);
    try {
      const response = await fetch(`/api/offers/${claimTarget.id}/claims`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: claimMessage || null }),
      });
      if (!response.ok) throw new Error("claim_failed");
      toast({
        tone: "success",
        title: t("offers_inbox.claim_sent_title"),
        description: t("offers_inbox.claim_sent_body"),
      });
      setClaimTarget(null);
      setClaimMessage("");
      setReload((value) => value + 1);
    } catch {
      toast({
        tone: "error",
        title: t("offers_inbox.claim_error_title"),
        description: t("common.error_generic"),
      });
    } finally {
      setClaiming(false);
    }
  }, [claimMessage, claimTarget, t, toast]);

  const withdrawClaim = useCallback(
    async (claim: InstitutionOfferClaim) => {
      setPendingClaimId(claim.id);
      try {
        const response = await fetch(`/api/offers/claims/${claim.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "withdrawn" }),
        });
        if (!response.ok) throw new Error("withdraw_failed");
        toast({ tone: "success", title: t("offers_inbox.withdraw_claim_toast") });
        setReload((value) => value + 1);
      } catch {
        toast({
          tone: "error",
          title: t("offers_inbox.claim_error_title"),
          description: t("common.error_generic"),
        });
      } finally {
        setPendingClaimId(null);
      }
    },
    [t, toast]
  );

  if (loggedIn === false) {
    return (
      <PageShell width="wide">
        <PageHeader
          title={t("offers_inbox.title")}
          subtitle={t("offers_inbox.subtitle")}
        />
        <EmptyState
          icon={<ShieldCheck className="h-10 w-10" aria-hidden="true" />}
          title={t("offers.sign_in_required")}
          action={
            <Link href="/auth/login" className={buttonClasses()}>
              {t("offers.sign_in_cta")}
            </Link>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell width="wide">
      <PageHeader
        title={t("offers_inbox.title")}
        subtitle={t("offers_inbox.subtitle")}
      />

      {forbidden ? (
        <EmptyState
          icon={<ShieldCheck className="h-10 w-10" aria-hidden="true" />}
          title={t("offers_inbox.not_verified_title")}
          description={t("offers_inbox.not_verified_body")}
        />
      ) : (
        <>
          <Card as="section" padding="lg" className="mb-8">
            <form
              className="grid gap-4 sm:grid-cols-3"
              onSubmit={(event) => {
                event.preventDefault();
                setApplied(draft);
              }}
            >
              <Field label={t("offers_inbox.filter_type")}>
                {(props) => (
                  <Select
                    {...props}
                    value={draft.donationType}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        donationType: event.target.value as DonationType | "all",
                      }))
                    }
                  >
                    <option value="all">{t("offers_inbox.filter_all")}</option>
                    {DONATION_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {locale === "hr"
                          ? DONATION_TYPES[key].labelHr
                          : DONATION_TYPES[key].label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label={t("offers_inbox.filter_city")}>
                {(props) => (
                  <Input
                    {...props}
                    interactive
                    value={draft.city}
                    maxLength={OFFER_CITY_MAX_LENGTH}
                    placeholder={t("offers_inbox.filter_city_placeholder")}
                    onChange={(event) =>
                      setDraft((previous) => ({ ...previous, city: event.target.value }))
                    }
                  />
                )}
              </Field>

              <Field label={t("offers_inbox.search_label")}>
                {(props) => (
                  <Input
                    {...props}
                    interactive
                    value={draft.query}
                    maxLength={OFFER_QUERY_MAX_LENGTH}
                    placeholder={t("offers_inbox.search_placeholder")}
                    onChange={(event) =>
                      setDraft((previous) => ({ ...previous, query: event.target.value }))
                    }
                  />
                )}
              </Field>

              <div className="flex flex-wrap gap-2 sm:col-span-3">
                <Button type="submit">{t("offers_inbox.apply_filters")}</Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDraft(EMPTY_FILTERS);
                    setApplied(EMPTY_FILTERS);
                  }}
                >
                  {t("offers_inbox.clear_filters")}
                </Button>
              </div>
            </form>
          </Card>

          <SectionHeader
            title={t("offers_inbox.browse_title")}
            description={t("offers_inbox.results_count", { count: total })}
          />

          {loading ? (
            <div
              className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
              role="status"
              aria-label={t("offers_inbox.loading")}
            >
              <OfferSkeleton />
              <OfferSkeleton />
              <OfferSkeleton />
            </div>
          ) : failed ? (
            <div role="alert">
              <EmptyState
                icon={<AlertTriangle className="h-10 w-10" aria-hidden="true" />}
                title={t("offers_inbox.error_loading")}
                action={
                  <Button variant="secondary" onClick={() => setReload((v) => v + 1)}>
                    {t("errors.retry")}
                  </Button>
                }
              />
            </div>
          ) : offers.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-10 w-10" aria-hidden="true" />}
              title={t("offers_inbox.empty")}
            />
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {offers.map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  action={
                    offer.claimed_by_us ? (
                      <Badge tone="info">{t("offers_inbox.claim_pending")}</Badge>
                    ) : (
                      <Button size="sm" onClick={() => setClaimTarget(offer)}>
                        {t("offers_inbox.claim_cta")}
                      </Button>
                    )
                  }
                />
              ))}
            </div>
          )}

          <SectionHeader className="mt-12" title={t("offers_inbox.our_claims_title")} />

          {claims.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-10 w-10" aria-hidden="true" />}
              title={t("offers_inbox.claims_empty")}
            />
          ) : (
            <ul className="grid gap-6 md:grid-cols-2">
              {claims.map((claim) => (
                <li key={claim.id}>
                  <OfferCard
                    offer={claim.offer}
                    badges={
                      <Badge
                        tone={
                          claim.status === "accepted"
                            ? "success"
                            : claim.status === "requested"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {t(CLAIM_STATUS_KEY[claim.status])}
                      </Badge>
                    }
                    action={
                      claim.status === "requested" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={pendingClaimId === claim.id}
                          onClick={() => void withdrawClaim(claim)}
                        >
                          {t("offers_inbox.withdraw_claim")}
                        </Button>
                      ) : undefined
                    }
                  >
                    <div className="mt-5 border-t border-border-subtle pt-4 text-sm">
                      {claim.status === "accepted" && claim.donor ? (
                        <div className="rounded-control bg-surface-sunken p-3">
                          <p className="font-semibold text-ink">
                            {t("offers_inbox.donor_contact")}
                          </p>
                          <ul className="mt-1 space-y-0.5 text-ink-secondary">
                            {claim.donor.name ? <li>{claim.donor.name}</li> : null}
                            {claim.donor.contact_person ? (
                              <li>{claim.donor.contact_person}</li>
                            ) : null}
                            {claim.donor.email ? <li>{claim.donor.email}</li> : null}
                          </ul>
                        </div>
                      ) : (
                        <p className="text-ink-tertiary">
                          {t("offers_inbox.donor_contact_hidden")}
                        </p>
                      )}
                    </div>
                  </OfferCard>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Dialog
        open={claimTarget !== null}
        onClose={() => setClaimTarget(null)}
        title={t("offers_inbox.claim_dialog_title", {
          title: claimTarget?.title ?? "",
        })}
        description={t("offers_inbox.donor_contact_hidden")}
        closeLabel={t("offers.close_dialog")}
        variant="sheet-on-mobile"
        footer={
          <>
            <Button loading={claiming} onClick={() => void sendClaim()}>
              {t("offers_inbox.claim_submit")}
            </Button>
            <Button variant="secondary" onClick={() => setClaimTarget(null)}>
              {t("common.cancel")}
            </Button>
          </>
        }
      >
        <Field label={t("offers_inbox.claim_message_label")}>
          {(props) => (
            <Textarea
              {...props}
              data-dialog-initial-focus
              value={claimMessage}
              maxLength={OFFER_CLAIM_MESSAGE_MAX_LENGTH}
              placeholder={t("offers_inbox.claim_message_placeholder")}
              onChange={(event) => setClaimMessage(event.target.value)}
            />
          )}
        </Field>
      </Dialog>
    </PageShell>
  );
}
