"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { useT, useLocale } from "@/i18n/client";
import { SDG_GOALS } from "@/lib/constants";
import type { Campaign, CompanyRole } from "@/lib/types";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SectionHeader,
  Textarea,
  useToast,
} from "@/components/ui";

type Props = {
  companyId: string;
  myRole: CompanyRole;
  campaigns: Campaign[];
};

export function CampaignsManager({ companyId, myRole, campaigns }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const canManage = myRole === "owner" || myRole === "admin";
  const formId = useId();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [target, setTarget] = useState("");
  const [sdgs, setSdgs] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  function reportFailure(detail?: unknown) {
    toast({
      tone: "error",
      title: t("errors.generic_title"),
      description: typeof detail === "string" ? detail : t("common.error_generic"),
    });
  }

  async function create() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/campaigns`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          starts_at: startsAt ? new Date(startsAt).toISOString() : null,
          ends_at: endsAt ? new Date(endsAt).toISOString() : null,
          target_amount_eur: target ? Number(target) : undefined,
          sdg_tags: sdgs,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : t("common.error_generic"));
        return;
      }
      toast({ tone: "success", title: t("company.campaign_created"), description: name.trim() });
      setName("");
      setDescription("");
      setStartsAt("");
      setEndsAt("");
      setTarget("");
      setSdgs([]);
      setOpen(false);
      router.refresh();
    } catch {
      setError(t("common.error_generic"));
    } finally {
      setSaving(false);
    }
  }

  /**
   * The rows come from the server, so this refetches — but it dims the row it is
   * changing rather than destroying the list.
   */
  async function toggleActive(id: string, active: boolean) {
    setTogglingId(id);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: active }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        reportFailure(data.error);
        return;
      }
      toast({ tone: "success", title: t("company.campaign_updated") });
      router.refresh();
    } catch {
      reportFailure();
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("company.campaigns_title")}
        actions={
          canManage ? (
            /* This button silently doubled as a close toggle: same label, same
               icon, no `aria-expanded`. It now says which way it goes. */
            <Button
              variant={open ? "secondary" : "primary"}
              aria-expanded={open}
              aria-controls={formId}
              onClick={() => setOpen((o) => !o)}
              icon={
                open ? (
                  <X className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden="true" />
                )
              }
            >
              {open ? t("common.cancel") : t("company.campaigns_new")}
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {open && canManage ? (
          <Card padding="lg" id={formId}>
            <SectionHeader title={t("company.campaigns_new")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={locale === "hr" ? "Naziv" : "Name"}
                required
                requiredLabel={t("common.required")}
                className="sm:col-span-2"
              >
                {(field) => (
                  <Input {...field} value={name} onChange={(e) => setName(e.target.value)} required />
                )}
              </Field>
              <Field
                label={locale === "hr" ? "Opis" : "Description"}
                className="sm:col-span-2"
              >
                {(field) => (
                  <Textarea
                    {...field}
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                )}
              </Field>
              <Field label={locale === "hr" ? "Početak" : "Starts"}>
                {(field) => (
                  <Input
                    {...field}
                    type="date"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                  />
                )}
              </Field>
              <Field label={locale === "hr" ? "Kraj" : "Ends"}>
                {(field) => (
                  <Input
                    {...field}
                    type="date"
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                  />
                )}
              </Field>
              <Field label={locale === "hr" ? "Cilj (EUR)" : "Target (EUR)"}>
                {(field) => (
                  <Input
                    {...field}
                    type="number"
                    min={0}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <fieldset className="mt-6">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                SDG
              </legend>
              <div className="flex flex-wrap gap-2">
                {SDG_GOALS.map((g) => {
                  const active = sdgs.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() =>
                        setSdgs((prev) =>
                          prev.includes(g.id)
                            ? prev.filter((n) => n !== g.id)
                            : [...prev, g.id]
                        )
                      }
                      aria-pressed={active}
                      title={locale === "hr" ? g.labelHr : g.label}
                      className={`inline-flex h-9 min-w-9 items-center justify-center rounded-full border px-2.5 text-xs font-semibold transition duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:active:scale-[0.97] ${
                        active
                          ? "border-transparent text-white"
                          : "border-border-subtle text-ink-secondary hover:border-border-strong hover:text-ink"
                      }`}
                      style={active ? { backgroundColor: g.color } : undefined}
                    >
                      {g.id}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
              >
                {error}
              </p>
            ) : null}

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => void create()}
                disabled={!name.trim()}
                loading={saving}
              >
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          </Card>
        ) : null}

        {campaigns.length === 0 ? (
          <EmptyState
            title={t("company.campaigns_empty")}
            action={
              canManage && !open ? (
                <Button
                  onClick={() => setOpen(true)}
                  icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                >
                  {t("company.campaigns_new")}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-3">
            {campaigns.map((c) => {
              const pending = togglingId === c.id;
              return (
                <li key={c.id} aria-busy={pending || undefined}>
                  <Card
                    padding="sm"
                    className={`transition-opacity ${pending ? "opacity-60" : ""}`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <h2 className="font-semibold text-ink">{c.name}</h2>
                        <p className="mt-0.5 text-sm tabular-nums text-ink-secondary">
                          {c.starts_at ? new Date(c.starts_at).toLocaleDateString() : "—"}
                          {" → "}
                          {c.ends_at ? new Date(c.ends_at).toLocaleDateString() : "—"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {c.sdg_tags?.slice(0, 5).map((id) => {
                          const g = SDG_GOALS.find((s) => s.id === id);
                          if (!g) return null;
                          return (
                            <span
                              key={id}
                              title={locale === "hr" ? g.labelHr : g.label}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                              style={{ backgroundColor: g.color }}
                            >
                              {id}
                            </span>
                          );
                        })}
                        {canManage ? (
                          <Button
                            size="sm"
                            variant={c.is_active ? "success" : "secondary"}
                            loading={pending}
                            onClick={() => void toggleActive(c.id, !c.is_active)}
                          >
                            {c.is_active
                              ? locale === "hr"
                                ? "Aktivna"
                                : "Active"
                              : locale === "hr"
                                ? "Pauzirana"
                                : "Paused"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {c.description ? (
                      <p className="mt-3 text-sm leading-6 text-ink-secondary">{c.description}</p>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
