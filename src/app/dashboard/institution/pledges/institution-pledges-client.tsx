"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Package } from "lucide-react";
import { useT } from "@/i18n/client";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PageShell,
  Skeleton,
  useToast,
} from "@/components/ui";
import type { BadgeTone } from "@/components/ui";

type Ack = { id: string; kind: string; signed_at: string; notes: string | null };
type PledgeRow = {
  id: string;
  quantity: number;
  status: string;
  amount_eur: number | null;
  delivered_at: string | null;
  tax_category: string;
  created_at: string;
  need: { title: string } | null;
  pledge_acknowledgements: Ack[] | null;
};

const STATUS_TONE: Record<string, BadgeTone> = {
  pledged: "warning",
  delivered: "info",
  confirmed: "success",
  cancelled: "neutral",
};

export function InstitutionPledgesClient() {
  const t = useT();
  const toast = useToast();
  const [pledges, setPledges] = useState<PledgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const load = useCallback(async () => {
    // Deliberately does not flip `loading` back on: it runs once on mount, and
    // the mutations below patch rows in place rather than refetching. Setting
    // `loading` here used to blank the whole list back to "Loading…" every
    // time a single pledge was acknowledged.
    try {
      const res = await fetch("/api/institution/pledges", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(typeof data.error === "string" ? data.error : t("common.error_generic"));
        return;
      }
      setLoadError(null);
      setPledges(data.pledges ?? []);
    } catch {
      setLoadError(t("common.error_generic"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function patchRow(id: string, patch: Partial<PledgeRow>) {
    setPledges((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function reportFailure(detail?: unknown) {
    toast({
      tone: "error",
      title: t("errors.generic_title"),
      description: typeof detail === "string" ? detail : t("common.error_generic"),
    });
  }

  /** Optimistic: the row moves to "delivered" immediately and rolls back on failure. */
  async function markDelivered(id: string) {
    const previous = pledges.find((p) => p.id === id);
    if (!previous) return;
    setBusy(id);
    patchRow(id, { status: "delivered" });
    try {
      const res = await fetch(`/api/pledges/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "delivered" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        patchRow(id, { status: previous.status, delivered_at: previous.delivered_at });
        reportFailure(data.error);
        return;
      }
      // Reconcile with the authoritative timestamp from the server.
      patchRow(id, {
        status: "delivered",
        delivered_at: typeof data.delivered_at === "string" ? data.delivered_at : null,
      });
      toast({ tone: "success", title: t("institution.mark_delivered") });
    } catch {
      patchRow(id, { status: previous.status, delivered_at: previous.delivered_at });
      reportFailure();
    } finally {
      setBusy(null);
    }
  }

  /** Optimistic: the acknowledgement badge appears at once, reconciled on response. */
  async function submitAck(id: string) {
    const previous = pledges.find((p) => p.id === id);
    if (!previous) return;
    const notes = noteText.trim();
    setBusy(id);
    setNotesFor(null);
    patchRow(id, {
      status: "confirmed",
      pledge_acknowledgements: [
        {
          id: `optimistic-${id}`,
          // Matches what `acknowledge_pledge_transaction` writes, so the
          // optimistic badge cannot disagree with the reconciled one.
          kind: "manual",
          signed_at: new Date().toISOString(),
          notes: notes || null,
        },
      ],
    });
    try {
      const res = await fetch(`/api/pledges/${id}/acknowledge`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        patchRow(id, {
          status: previous.status,
          pledge_acknowledgements: previous.pledge_acknowledgements,
        });
        setNotesFor(id);
        reportFailure(data.error);
        return;
      }
      const ack = data.acknowledgement as Ack | undefined;
      patchRow(id, {
        status: "confirmed",
        pledge_acknowledgements: ack ? [ack] : previous.pledge_acknowledgements,
      });
      setNoteText("");
      toast({ tone: "success", title: t("institution.acknowledged") });
    } catch {
      patchRow(id, {
        status: previous.status,
        pledge_acknowledgements: previous.pledge_acknowledgements,
      });
      setNotesFor(id);
      reportFailure();
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell width="content">
      <Link
        href="/dashboard/institution"
        className="mb-6 inline-flex items-center gap-2 rounded text-sm font-semibold text-brand transition-colors hover:text-brand-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("common.back")}
      </Link>

      <PageHeader
        title={t("institution.pledges_title")}
        subtitle={t("institution.pledges_subtitle")}
      />

      {loading ? (
        <ul className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </ul>
      ) : loadError ? (
        <EmptyState
          title={t("errors.generic_title")}
          description={loadError}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              {t("errors.retry")}
            </Button>
          }
        />
      ) : pledges.length === 0 ? (
        <EmptyState title={t("institution.pledges_empty")} />
      ) : (
        <ul className="space-y-3">
          {pledges.map((p) => {
            const acks = p.pledge_acknowledgements;
            const ack = Array.isArray(acks) && acks.length > 0 ? acks[0] : null;
            const pending = busy === p.id;
            return (
              <li
                key={p.id}
                aria-busy={pending || undefined}
                className={
                  pending
                    ? "rounded-card border border-border-subtle bg-surface-raised p-4 opacity-60 shadow-raised transition-opacity"
                    : "rounded-card border border-border-subtle bg-surface-raised p-4 shadow-raised transition-opacity"
                }
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      {p.need?.title ?? t("institution.pledges_need")}
                    </p>
                    <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                      <div>
                        <dt className="inline font-medium uppercase tracking-wide text-ink-tertiary">
                          {t("institution.pledges_status")}:{" "}
                        </dt>
                        <dd className="inline">
                          <Badge tone={STATUS_TONE[p.status] ?? "neutral"} size="sm">
                            {p.status}
                          </Badge>
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-medium uppercase tracking-wide text-ink-tertiary">
                          {t("your_pledges.qty_label")}:{" "}
                        </dt>
                        <dd className="inline font-semibold tabular-nums text-ink">
                          {p.quantity}
                        </dd>
                      </div>
                      {p.amount_eur != null ? (
                        <div>
                          <dt className="inline font-medium uppercase tracking-wide text-ink-tertiary">
                            {t("institution.pledges_amount")}:{" "}
                          </dt>
                          <dd className="inline font-semibold tabular-nums text-ink">
                            {`€${Number(p.amount_eur).toFixed(2)}`}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-start gap-2">
                    {p.status === "pledged" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => void markDelivered(p.id)}
                        icon={<Package className="h-3.5 w-3.5" aria-hidden="true" />}
                      >
                        {t("institution.mark_delivered")}
                      </Button>
                    ) : null}

                    {p.status === "delivered" && !ack ? (
                      notesFor === p.id ? (
                        <div className="flex w-full flex-col gap-2 sm:w-64">
                          <Field label={t("institution.notes_placeholder")}>
                            {(field) => (
                              <Input
                                {...field}
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                maxLength={2000}
                              />
                            )}
                          </Field>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={pending}
                              onClick={() => void submitAck(p.id)}
                            >
                              {t("common.confirm")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setNotesFor(null);
                                setNoteText("");
                              }}
                            >
                              {t("common.cancel")}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => setNotesFor(p.id)}
                          icon={<Check className="h-3.5 w-3.5" aria-hidden="true" />}
                        >
                          {t("institution.acknowledge")}
                        </Button>
                      )
                    ) : null}

                    {ack ? (
                      <Badge tone="success" icon={<Check className="h-3 w-3" aria-hidden="true" />}>
                        {t("institution.acknowledged")} ({ack.kind})
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
