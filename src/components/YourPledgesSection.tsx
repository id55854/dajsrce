"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { useT } from "@/i18n/client";
import { timeAgo } from "@/lib/utils";
import { Button, Dialog, Skeleton, useToast } from "@/components/ui";

/**
 * Shape returned by GET /api/pledges (with `need:needs(*, institution:...)`).
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
  status?: string | null;
  created_at: string;
  need?: {
    id: string;
    title: string;
    institution?: { id: string; name: string } | null;
  } | null;
};

const VISIBLE_LIMIT = 6;

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
  /** Write target, e.g. `/api/pledges/<id>`. */
  endpoint: string;
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
      const res = await fetch(endpoint, { method, credentials: "include" });
      if (!res.ok) {
        toast({
          tone: "error",
          title: errorTitle,
          description:
            res.status === 409 ? conflictDescription : t("common.error_generic"),
        });
        return;
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
  // The list belongs to the parent, so a row withdrawn here is remembered
  // locally and dropped from the list until the parent refetches.
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(() => new Set());

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
            <Skeleton key={i} className="h-28 w-64 shrink-0 rounded-card" />
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
      subtitle={t("your_pledges.section_subtitle")}
      action={
        <Link
          href="/dashboard/individual"
          className="inline-flex items-center gap-1 rounded text-sm font-semibold text-brand transition-colors hover:text-brand-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {t("your_pledges.view_all")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      {current.length === 0 ? (
        <p className="text-sm text-ink-secondary">{t("your_pledges.empty")}</p>
      ) : (
        <ul
          className="flex snap-x gap-3 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible"
          role="list"
        >
          {visible.map((p) => {
            return (
              <li key={p.id} className="w-72 shrink-0 snap-start md:max-w-xs">
                <article className="flex h-full flex-col rounded-card border border-border-subtle bg-surface-raised p-4 shadow-raised">
                  <div className="mb-2 flex items-start justify-end gap-2">
                    <time className="shrink-0 text-xs text-ink-tertiary" dateTime={p.created_at}>
                      {timeAgo(p.created_at)}
                    </time>
                  </div>
                  <h3 className="line-clamp-2 text-sm font-semibold text-ink">
                    {p.need?.title ?? "—"}
                  </h3>
                  {p.need?.institution?.name ? (
                    <p className="mt-0.5 line-clamp-1 text-xs text-ink-secondary">
                      {p.need.institution.name}
                    </p>
                  ) : null}
                  <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <div>
                      <dt className="inline font-medium uppercase tracking-wide text-ink-tertiary">
                        {t("your_pledges.qty_label")}:{" "}
                      </dt>
                      <dd className="inline font-semibold tabular-nums text-ink">{p.quantity}</dd>
                    </div>
                    {p.amount_eur != null ? (
                      <div>
                        <dt className="inline font-medium uppercase tracking-wide text-ink-tertiary">
                          {t("your_pledges.amount_label")}:{" "}
                        </dt>
                        <dd className="inline font-semibold tabular-nums text-ink">
                          {formatEur(p.amount_eur)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <div className="mt-auto flex flex-wrap justify-end gap-2 pt-3">
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
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
      {overflow > 0 ? (
        <p className="mt-2 text-xs text-ink-tertiary">+{overflow} more</p>
      ) : null}
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
      className="mb-8 rounded-card border border-border-subtle bg-surface-raised p-5 shadow-raised"
      aria-labelledby="your-pledges-heading"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="your-pledges-heading" className="text-lg font-semibold text-ink">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-ink-secondary">{subtitle}</p>
          ) : null}
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
