"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Heart, Trash2, X } from "lucide-react";
import { useLocale, useT } from "@/i18n/client";
import { timeAgo } from "@/lib/utils";
import { RosterIcon, RosterItem, RosterQuantity } from "@/components/Roster";
import { DonationTypeIcon } from "@/components/DonationTypeIcon";
import {
  PledgeDetailsDialog,
  type PledgeHandoverInstitution,
} from "@/components/PledgeDetailsDialog";
import { DONATION_TYPES } from "@/lib/constants";
import type { DonationType } from "@/lib/types";
import { Button, Dialog, Skeleton, useToast } from "@/components/ui";

/**
 * Shape returned by GET /api/pledges (with `need:needs(..., institution:...)`).
 * The institution carries its public contact and drop-off details, which the
 * details dialog shows as the handover.
 *
 * `status` is carried but never shown. A promise no longer has a lifecycle a
 * donor is asked to follow: it is made, and it can be withdrawn. The column
 * survives only so a withdrawn row can be left out of this list; see the
 * project notes on why the database keeps it.
 */
export type YourPledgeRow = {
  id: string;
  user_id: string;
  need_id: string;
  quantity: number;
  amount_eur?: number | null;
  message?: string | null;
  status?: string | null;
  created_at: string;
  need?: {
    id: string;
    title: string;
    description?: string | null;
    donation_type?: string | null;
    deadline?: string | null;
    quantity_needed?: number | null;
    quantity_pledged?: number | null;
    institution?: PledgeHandoverInstitution | null;
  } | null;
};

const VISIBLE_LIMIT = 3;

/**
 * Confirm-then-write affordance shared by every control that withdraws a
 * promise: pledges here, volunteer signups on the individual dashboard.
 *
 * It reports both outcomes through the toast channel; an action that silently
 * does nothing is the failure mode this replaces; and never assumes success:
 * the server owns the refusal and answers 409, which surfaces as
 * `conflictDescription`.
 */
function ConfirmActionButton({
  endpoint,
  method,
  icon,
  variant,
  label,
  title,
  description,
  confirmLabel,
  confirmVariant,
  successTitle,
  errorTitle,
  conflictDescription,
  onDone,
}: {
  /**
   * Write target, e.g. `/api/pledges/<id>`. Several targets run one after
   * another (withdrawing every pledge someone made to one need); each is its
   * own server transaction, and the first refusal stops the rest.
   */
  endpoint: string | readonly string[];
  method: "DELETE";
  icon: ReactNode;
  variant: "ghost" | "secondary";
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant: "danger" | "primary";
  successTitle: string;
  errorTitle: string;
  /** Why the server refused when the row has already become evidence. */
  conflictDescription: string;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      for (const target of typeof endpoint === "string" ? [endpoint] : endpoint) {
        const res = await fetch(target, { method, credentials: "include" });
        if (!res.ok) {
          toast({
            tone: "error",
            title: errorTitle,
            description:
              res.status === 409 ? conflictDescription : t("common.error_generic"),
          });
          return;
        }
      }
      toast({ tone: "success", title: successTitle });
      onDone();
    } catch {
      toast({
        tone: "error",
        title: errorTitle,
        description: t("common.error_generic"),
      });
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <>
      {/* Default size: 44px, the minimum comfortable touch target. */}
      <Button variant={variant} icon={icon} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={title}
        description={description}
        closeLabel={t("common.close")}
        variant="sheet-on-mobile"
        footer={
          <>
            <Button
              variant={confirmVariant}
              fullWidth
              loading={busy}
              onClick={confirm}
              data-dialog-initial-focus
            >
              {confirmLabel}
            </Button>
            <Button
              variant="secondary"
              fullWidth
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t("common.cancel")}
            </Button>
          </>
        }
      />
    </>
  );
}

/** Withdraw a promise. */
export function CancelActionButton(
  props: Omit<
    Parameters<typeof ConfirmActionButton>[0],
    "method" | "icon" | "variant" | "confirmVariant" | "onDone"
  > & { onCancelled: () => void }
) {
  const { onCancelled, ...rest } = props;
  return (
    <ConfirmActionButton
      {...rest}
      method="DELETE"
      icon={<X className="h-4 w-4" aria-hidden="true" />}
      variant="ghost"
      confirmVariant="danger"
      onDone={onCancelled}
    />
  );
}

/** The same confirm-then-DELETE control, worded and drawn as a deletion. */
export function DeleteActionButton(
  props: Omit<
    Parameters<typeof ConfirmActionButton>[0],
    "method" | "icon" | "variant" | "confirmVariant" | "onDone"
  > & { onDeleted: () => void }
) {
  const { onDeleted, ...rest } = props;
  return (
    <ConfirmActionButton
      {...rest}
      method="DELETE"
      icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
      variant="ghost"
      confirmVariant="danger"
      onDone={onDeleted}
    />
  );
}

export function YourPledgesSection({
  loggedIn,
  loading,
  pledges,
  onCancelled,
}: {
  loggedIn: boolean;
  loading: boolean;
  pledges: YourPledgeRow[];
  /** Optional: parents that keep their own copy can refetch after a cancel. */
  onCancelled?: (pledgeId: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  // The list belongs to the parent, so a row withdrawn here is remembered
  // locally and dropped from the list until the parent refetches.
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(() => new Set());

  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const isWithdrawn = (p: YourPledgeRow) =>
    cancelledIds.has(p.id) || p.status === "cancelled";

  if (!loggedIn) {
    return (
      <SectionWrapper title={t("your_pledges.section_title")}>
        <p className="text-sm text-ink-secondary">{t("your_pledges.signed_out")}</p>
      </SectionWrapper>
    );
  }

  if (loading && pledges.length === 0) {
    return (
      <SectionWrapper title={t("your_pledges.section_title")}>
        <div className="flex gap-3 overflow-hidden" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-5 w-32 shrink-0 rounded-control" />
          ))}
        </div>
      </SectionWrapper>
    );
  }

  if (pledges.length === 0) {
    return (
      <SectionWrapper title={t("your_pledges.section_title")}>
        <p className="text-sm text-ink-secondary">{t("your_pledges.empty")}</p>
      </SectionWrapper>
    );
  }

  // A withdrawn promise is not one of your donations, so it leaves the list
  // rather than sitting in it wearing a "cancelled" label.
  const current = pledges.filter((p) => !isWithdrawn(p));
  const visible = current.slice(0, VISIBLE_LIMIT);
  const overflow = current.length - visible.length;

  return (
    <SectionWrapper
      title={t("your_pledges.section_title")}
      action={
        <Link
          href="/dashboard/individual"
          className="inline-flex items-center gap-1 rounded text-sm font-semibold text-brand transition-colors hover:text-brand-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {t("your_pledges.view_all_short")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-controls={listId} className="flex min-h-10 w-full items-center justify-between gap-2 rounded-control text-left text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        {expanded ? t("your_pledges.hide_summary") : t("your_pledges.summary_count", { count: current.length })}
        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <div id={listId} hidden={!expanded}>
      {current.length === 0 ? (
        <p className="text-sm text-ink-secondary">{t("your_pledges.empty")}</p>
      ) : (
        <ul
          className="divide-y divide-border-subtle"
          role="list"
        >
          {visible.map((p) => (
            <RosterItem
              key={p.id}
              flush
              onOpen={() => setOpenId(p.id)}
              leading={
                <RosterIcon tone="brand">
                  {p.need?.donation_type && p.need.donation_type in DONATION_TYPES ? (
                    <DonationTypeIcon type={p.need.donation_type as DonationType} className="h-4 w-4" />
                  ) : (
                    <Heart className="h-4 w-4" />
                  )}
                </RosterIcon>
              }
              title={p.need?.title ?? "—"}
              subtitle={[p.need?.institution?.name, donationTypeLabel(p.need?.donation_type, locale)]
                .filter(Boolean)
                .join(" · ")}
              detail={<time dateTime={p.created_at}>{timeAgo(p.created_at, locale)}</time>}
              aside={
                <RosterQuantity
                  value={p.quantity}
                  label={p.amount_eur != null ? formatEur(p.amount_eur) : t("your_pledges.qty_label")}
                />
              }
              action={
                <CancelActionButton
                  endpoint={`/api/pledges/${p.id}`}
                  label={t("your_pledges.cancel")}
                  title={t("your_pledges.cancel_title")}
                  description={t("your_pledges.cancel_body", {
                    title: p.need?.title ?? "",
                  })}
                  confirmLabel={t("your_pledges.cancel_confirm")}
                  successTitle={t("your_pledges.cancel_success")}
                  errorTitle={t("your_pledges.cancel_error")}
                  conflictDescription={t("your_pledges.cancel_error_locked")}
                  onCancelled={() => {
                    setCancelledIds((prev) => new Set(prev).add(p.id));
                    onCancelled?.(p.id);
                  }}
                />
              }
            />
          ))}
        </ul>
      )}
      {overflow > 0 ? (
        <p className="mt-2 text-xs text-ink-tertiary">{t("your_pledges.more_count", { count: overflow })}</p>
      ) : null}
      </div>
      <PledgeDetailsDialog
        pledge={current.find((p) => p.id === openId) ?? null}
        onClose={() => setOpenId(null)}
        footer={
          openId ? (
            <CancelActionButton
              endpoint={`/api/pledges/${openId}`}
              label={t("your_pledges.cancel")}
              title={t("your_pledges.cancel_title")}
              description={t("your_pledges.cancel_body", {
                title: current.find((p) => p.id === openId)?.need?.title ?? "",
              })}
              confirmLabel={t("your_pledges.cancel_confirm")}
              successTitle={t("your_pledges.cancel_success")}
              errorTitle={t("your_pledges.cancel_error")}
              conflictDescription={t("your_pledges.cancel_error_locked")}
              onCancelled={() => {
                const id = openId;
                setOpenId(null);
                setCancelledIds((prev) => new Set(prev).add(id));
                onCancelled?.(id);
              }}
            />
          ) : null
        }
      />
    </SectionWrapper>
  );
}

function SectionWrapper({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="mb-4 rounded-card border border-border-subtle bg-surface-raised px-4 py-3 shadow-raised"
      aria-labelledby="your-pledges-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-on-soft">
            <Heart className="h-4 w-4" />
          </span>
          <div>
            <h2 id="your-pledges-heading" className="text-base font-semibold text-ink">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1 text-sm text-ink-secondary">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function formatEur(value: number): string {
  return new Intl.NumberFormat("hr-HR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function donationTypeLabel(type: string | null | undefined, locale: "hr" | "en"): string | null {
  if (!type || !(type in DONATION_TYPES)) return null;
  const config = DONATION_TYPES[type as keyof typeof DONATION_TYPES];
  return locale === "hr" ? config.labelHr : config.label;
}
