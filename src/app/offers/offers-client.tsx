"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, HeartHandshake, PackageOpen } from "lucide-react";
import { DONATION_TYPES } from "@/lib/constants";
import type { DonationType } from "@/lib/types";
import {
  OFFER_CITY_MAX_LENGTH,
  OFFER_DESCRIPTION_MAX_LENGTH,
  OFFER_QUANTITY_MAX,
  OFFER_TITLE_MAX_LENGTH,
  OFFER_UNIT_MAX_LENGTH,
  type AuthorOffer,
  type AuthorOfferClaim,
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

const CLAIM_STATUS_KEY: Record<AuthorOfferClaim["status"], string> = {
  requested: "offers.claim_status_requested",
  accepted: "offers.claim_status_accepted",
  declined: "offers.claim_status_declined",
  withdrawn: "offers.claim_status_withdrawn",
};

type FormState = {
  title: string;
  description: string;
  donationType: DonationType;
  quantity: string;
  unit: string;
  city: string;
  availableUntil: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  donationType: "clothes",
  quantity: "1",
  unit: "",
  city: "",
  availableUntil: "",
};

function OfferSkeleton() {
  return (
    <Card>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-28 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-6 w-3/4" />
      <SkeletonText className="mt-3" lines={3} />
      <Skeleton className="mt-5 h-4 w-40" />
      <Skeleton className="mt-5 h-11 w-36 rounded-full" />
    </Card>
  );
}

/**
 * The donor's own page: publish an offer, then answer the organisations that
 * ask for it. The exact address is never collected — only the city — and the
 * requesting organisation's contact details appear only after an acceptance.
 */
export function OffersClient() {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();

  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [offers, setOffers] = useState<AuthorOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [pendingClaimId, setPendingClaimId] = useState<string | null>(null);
  const [pendingOfferId, setPendingOfferId] = useState<string | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<AuthorOffer | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFailed(false);
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

        const response = await fetch("/api/offers?scope=mine", {
          credentials: "include",
        });
        if (!response.ok) throw new Error("offers_unavailable");
        const payload = (await response.json()) as { items?: AuthorOffer[] };
        if (!cancelled) setOffers(payload.items ?? []);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const patch = useCallback((next: Partial<FormState>) => {
    setForm((previous) => ({ ...previous, ...next }));
  }, []);

  const submit = useCallback(async () => {
    setSubmitting(true);
    try {
      const response = await fetch("/api/offers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          donation_type: form.donationType,
          quantity: Number(form.quantity) || 1,
          unit: form.unit || null,
          city: form.city,
          available_until: form.availableUntil || null,
        }),
      });
      const payload = (await response.json()) as { offer?: AuthorOffer };
      if (!response.ok || !payload.offer) throw new Error("create_failed");

      setOffers((previous) => [payload.offer as AuthorOffer, ...previous]);
      setForm(EMPTY_FORM);
      toast({
        tone: "success",
        title: t("offers.created_toast_title"),
        description: t("offers.created_toast_body"),
      });
    } catch {
      toast({
        tone: "error",
        title: t("offers.create_error_title"),
        description: t("common.error_generic"),
      });
    } finally {
      setSubmitting(false);
    }
  }, [form, t, toast]);

  const decide = useCallback(
    async (claim: AuthorOfferClaim, decision: "accepted" | "declined") => {
      setPendingClaimId(claim.id);
      try {
        const response = await fetch(`/api/offers/claims/${claim.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        });
        if (!response.ok) throw new Error("decision_failed");
        toast({
          tone: "success",
          title: t(
            decision === "accepted"
              ? "offers.claim_accepted_toast_title"
              : "offers.claim_declined_toast_title"
          ),
          description:
            decision === "accepted"
              ? t("offers.claim_accepted_toast_body")
              : undefined,
        });
        // The accept path rewrites sibling claims and the offer status inside
        // one transaction, so re-read rather than patching rows locally.
        setReload((value) => value + 1);
      } catch {
        toast({
          tone: "error",
          title: t("offers.claim_error_title"),
          description: t("common.error_generic"),
        });
      } finally {
        setPendingClaimId(null);
      }
    },
    [t, toast]
  );

  const setStatus = useCallback(
    async (offer: AuthorOffer, status: "withdrawn" | "fulfilled") => {
      setPendingOfferId(offer.id);
      try {
        const response = await fetch(`/api/offers/${offer.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!response.ok) throw new Error("update_failed");
        toast({
          tone: "success",
          title: t(
            status === "withdrawn"
              ? "offers.withdrawn_toast_title"
              : "offers.fulfilled_toast_title"
          ),
        });
        setReload((value) => value + 1);
      } catch {
        toast({
          tone: "error",
          title: t("offers.update_error_title"),
          description: t("common.error_generic"),
        });
      } finally {
        setPendingOfferId(null);
        setWithdrawTarget(null);
      }
    },
    [t, toast]
  );

  const formValid =
    form.title.trim().length >= 3 && form.city.trim().length >= 2 && !submitting;

  if (loggedIn === false) {
    return (
      <PageShell width="content">
        <PageHeader title={t("offers.title")} subtitle={t("offers.subtitle")} />
        <EmptyState
          icon={<HeartHandshake className="h-10 w-10" aria-hidden="true" />}
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
    <PageShell width="content">
      <PageHeader title={t("offers.title")} subtitle={t("offers.subtitle")} />

      <Card as="section" padding="lg" className="mb-10">
        <SectionHeader
          title={t("offers.new_title")}
          description={t("offers.privacy_note")}
        />
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (formValid) void submit();
          }}
        >
          <Field label={t("offers.form_title_label")} required requiredLabel={t("common.required")}>
            {(props) => (
              <Input
                {...props}
                value={form.title}
                maxLength={OFFER_TITLE_MAX_LENGTH}
                placeholder={t("offers.form_title_placeholder")}
                onChange={(event) => patch({ title: event.target.value })}
              />
            )}
          </Field>

          <Field label={t("offers.form_description_label")}>
            {(props) => (
              <Textarea
                {...props}
                value={form.description}
                maxLength={OFFER_DESCRIPTION_MAX_LENGTH}
                placeholder={t("offers.form_description_placeholder")}
                onChange={(event) => patch({ description: event.target.value })}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("offers.form_type_label")} required requiredLabel={t("common.required")}>
              {(props) => (
                <Select
                  {...props}
                  value={form.donationType}
                  onChange={(event) =>
                    patch({ donationType: event.target.value as DonationType })
                  }
                >
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

            <Field label={t("offers.form_city_label")} required requiredLabel={t("common.required")}>
              {(props) => (
                <Input
                  {...props}
                  value={form.city}
                  maxLength={OFFER_CITY_MAX_LENGTH}
                  placeholder={t("offers.form_city_placeholder")}
                  onChange={(event) => patch({ city: event.target.value })}
                />
              )}
            </Field>

            <Field label={t("offers.form_quantity_label")}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={OFFER_QUANTITY_MAX}
                  value={form.quantity}
                  onChange={(event) => patch({ quantity: event.target.value })}
                />
              )}
            </Field>

            <Field label={t("offers.form_unit_label")}>
              {(props) => (
                <Input
                  {...props}
                  value={form.unit}
                  maxLength={OFFER_UNIT_MAX_LENGTH}
                  placeholder={t("offers.form_unit_placeholder")}
                  onChange={(event) => patch({ unit: event.target.value })}
                />
              )}
            </Field>

            <Field
              label={t("offers.form_available_until_label")}
              hint={t("offers.form_available_until_hint")}
            >
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  value={form.availableUntil}
                  onChange={(event) => patch({ availableUntil: event.target.value })}
                />
              )}
            </Field>
          </div>

          <Button type="submit" loading={submitting} disabled={!formValid}>
            {submitting ? t("offers.form_submitting") : t("offers.form_submit")}
          </Button>
        </form>
      </Card>

      <SectionHeader title={t("offers.mine_title")} />

      {loading ? (
        <div className="grid gap-6 sm:grid-cols-2" role="status" aria-label={t("offers.loading")}>
          <OfferSkeleton />
          <OfferSkeleton />
        </div>
      ) : failed ? (
        <div role="alert">
          <EmptyState
            icon={<AlertTriangle className="h-10 w-10" aria-hidden="true" />}
            title={t("offers.error_loading")}
            action={
              <Button variant="secondary" onClick={() => setReload((v) => v + 1)}>
                {t("errors.retry")}
              </Button>
            }
          />
        </div>
      ) : offers.length === 0 ? (
        <EmptyState
          icon={<PackageOpen className="h-10 w-10" aria-hidden="true" />}
          title={t("offers.mine_empty")}
          description={t("offers.mine_empty_hint")}
        />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {offers.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              action={
                offer.status === "open" || offer.status === "claimed" ? (
                  <div className="flex flex-wrap gap-2">
                    {offer.status === "claimed" ? (
                      <Button
                        size="sm"
                        variant="success"
                        loading={pendingOfferId === offer.id}
                        onClick={() => void setStatus(offer, "fulfilled")}
                      >
                        {t("offers.mark_fulfilled")}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setWithdrawTarget(offer)}
                    >
                      {t("offers.withdraw")}
                    </Button>
                  </div>
                ) : undefined
              }
            >
              <div className="mt-5 border-t border-border-subtle pt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                  {t("offers.claims_title")}
                </p>
                {offer.claims.length === 0 ? (
                  <p className="text-sm text-ink-tertiary">{t("offers.claims_empty")}</p>
                ) : (
                  <ul className="space-y-3">
                    {offer.claims.map((claim) => (
                      <li
                        key={claim.id}
                        className="rounded-control border border-border-subtle p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-ink">
                            {claim.institution_name}
                          </span>
                          <Badge
                            size="sm"
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
                        </div>
                        {claim.institution_city ? (
                          <p className="mt-1 text-sm text-ink-tertiary">
                            {claim.institution_city}
                          </p>
                        ) : null}
                        {claim.message ? (
                          <p className="mt-2 text-sm leading-6 text-ink-secondary">
                            {claim.message}
                          </p>
                        ) : null}

                        {claim.status === "accepted" && claim.contact ? (
                          <div className="mt-3 rounded-control bg-surface-sunken p-3 text-sm">
                            <p className="font-semibold text-ink">
                              {t("offers.contact_revealed")}
                            </p>
                            <ul className="mt-1 space-y-0.5 text-ink-secondary">
                              {claim.contact.email ? <li>{claim.contact.email}</li> : null}
                              {claim.contact.phone ? <li>{claim.contact.phone}</li> : null}
                              {claim.contact.website ? (
                                <li className="truncate">{claim.contact.website}</li>
                              ) : null}
                            </ul>
                          </div>
                        ) : claim.status === "requested" ? (
                          <>
                            <p className="mt-2 text-sm text-ink-tertiary">
                              {t("offers.contact_hidden")}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                loading={pendingClaimId === claim.id}
                                onClick={() => void decide(claim, "accepted")}
                              >
                                {t("offers.claim_accept")}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={pendingClaimId === claim.id}
                                onClick={() => void decide(claim, "declined")}
                              >
                                {t("offers.claim_decline")}
                              </Button>
                            </div>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </OfferCard>
          ))}
        </div>
      )}

      <Dialog
        open={withdrawTarget !== null}
        onClose={() => setWithdrawTarget(null)}
        title={t("offers.withdraw_confirm_title")}
        description={t("offers.withdraw_confirm_body")}
        closeLabel={t("offers.close_dialog")}
        variant="sheet-on-mobile"
        footer={
          <>
            <Button
              variant="danger"
              data-dialog-initial-focus
              loading={pendingOfferId === withdrawTarget?.id}
              onClick={() => {
                if (withdrawTarget) void setStatus(withdrawTarget, "withdrawn");
              }}
            >
              {t("offers.withdraw_confirm_cta")}
            </Button>
            <Button variant="secondary" onClick={() => setWithdrawTarget(null)}>
              {t("common.cancel")}
            </Button>
          </>
        }
      />
    </PageShell>
  );
}
