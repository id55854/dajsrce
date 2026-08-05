"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Globe, Mail, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useT, useLocale } from "@/i18n/client";
import { COMPANY_ROLE_LABELS } from "@/lib/constants";
import type {
  CompanyDomain,
  CompanyInvite,
  CompanyMember,
  CompanyRole,
} from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Input,
  PageHeader,
  SectionHeader,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";

type Props = {
  companyId: string;
  myRole: CompanyRole;
  members: CompanyMember[];
  invites: CompanyInvite[];
  domains: CompanyDomain[];
};

export function TeamManager({ companyId, myRole, members, invites, domains }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const canManage = myRole === "owner" || myRole === "admin";

  const [inviteInput, setInviteInput] = useState("");
  const [inviteRole, setInviteRole] = useState<"employee" | "admin" | "finance">("employee");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ email: string; url: string }[] | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [domainInput, setDomainInput] = useState("");
  const [domainError, setDomainError] = useState<string | null>(null);
  const [domainLoading, setDomainLoading] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Removal is destructive, so it gets a real dialog rather than the browser's
  // `window.confirm()` — which is unstyled, unlocalised and untestable.
  const [pendingRemoval, setPendingRemoval] = useState<CompanyMember | null>(null);
  const [removing, setRemoving] = useState(false);

  function reportFailure(detail?: unknown) {
    toast({
      tone: "error",
      title: t("errors.generic_title"),
      description: typeof detail === "string" ? detail : t("common.error_generic"),
    });
  }

  async function sendInvites() {
    setInviteError(null);
    setInviteResult(null);
    const emails = inviteInput
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (emails.length === 0) {
      setInviteError(t("common.error_generic"));
      return;
    }
    setInviteLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/invites`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails, role: inviteRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteError(typeof data.error === "string" ? data.error : t("common.error_generic"));
        return;
      }
      setInviteResult(
        (data.invites as Array<{ email: string; accept_url: string }>).map((i) => ({
          email: i.email,
          url: i.accept_url,
        }))
      );
      setInviteInput("");
      toast({ tone: "success", title: t("company.team_invite_sent") });
      router.refresh();
    } catch {
      setInviteError(t("common.error_generic"));
    } finally {
      setInviteLoading(false);
    }
  }

  async function addDomain() {
    setDomainError(null);
    setDomainLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/domains`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domainInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      // Adding a domain used to report nothing at all, success or failure.
      if (!res.ok) {
        setDomainError(typeof data.error === "string" ? data.error : t("common.error_generic"));
        return;
      }
      setDomainInput("");
      toast({ tone: "success", title: t("company.domain_added") });
      router.refresh();
    } catch {
      setDomainError(t("common.error_generic"));
    } finally {
      setDomainLoading(false);
    }
  }

  async function verifyDomain(domainId: string) {
    setVerifyingId(domainId);
    try {
      // The response used to be discarded, so "TXT record not visible yet" and
      // "verified" were indistinguishable to the user.
      const res = await fetch(`/api/companies/${companyId}/domains/${domainId}/verify`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ tone: "error", title: t("company.domain_verify_failed") });
        return;
      }
      const verified = data?.verified !== false;
      toast({
        tone: verified ? "success" : "warning",
        title: verified
          ? t("company.domain_verify_success")
          : t("company.domain_verify_failed"),
      });
      router.refresh();
    } catch {
      reportFailure();
    } finally {
      setVerifyingId(null);
    }
  }

  async function removeMember() {
    const member = pendingRemoval;
    if (!member) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/members/${member.profile_id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        reportFailure(data.error);
        return;
      }
      setPendingRemoval(null);
      toast({
        tone: "success",
        title: t("company.member_removed"),
        description: member.profile?.email ?? member.profile?.name ?? undefined,
      });
      router.refresh();
    } catch {
      reportFailure();
    } finally {
      setRemoving(false);
    }
  }

  async function copyToken(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedToken(value);
      setTimeout(() => setCopiedToken(null), 1500);
    } catch {
      reportFailure();
    }
  }

  return (
    <div>
      <PageHeader title={t("company.team_title")} />

      <div className="space-y-8">
        <Card padding="lg">
          <SectionHeader
            title={t("company.team_title")}
            actions={<Badge tone="neutral">{members.length}</Badge>}
          />
          {members.length === 0 ? (
            <p className="text-sm text-ink-secondary">{t("company.team_empty")}</p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => {
                const role = COMPANY_ROLE_LABELS[m.role];
                return (
                  <li
                    key={m.id}
                    className="flex flex-col gap-3 rounded-control border border-border-subtle bg-surface-sunken px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{m.profile?.name ?? "—"}</p>
                      <p className="truncate text-sm text-ink-secondary">
                        {m.profile?.email ?? ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge tone="brand">{locale === "hr" ? role.labelHr : role.label}</Badge>
                      {canManage && m.role !== "owner" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-3"
                          onClick={() => setPendingRemoval(m)}
                          aria-label={`${t("common.delete")} — ${m.profile?.email ?? m.profile?.name ?? ""}`}
                          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {canManage ? (
          <Card padding="lg">
            <SectionHeader
              title={
                <span className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-brand" aria-hidden="true" />
                  {t("company.team_invite_cta")}
                </span>
              }
            />

            <div className="space-y-4">
              <Field label={t("company.invite_emails_label")} error={inviteError}>
                {(field) => (
                  <Textarea
                    {...field}
                    rows={2}
                    value={inviteInput}
                    onChange={(e) => {
                      setInviteInput(e.target.value);
                      setInviteError(null);
                    }}
                    placeholder="ana@firma.hr, ivan@firma.hr"
                    invalid={!!inviteError}
                  />
                )}
              </Field>
              <div className="flex flex-wrap items-end gap-3">
                <Field label={locale === "hr" ? "Rola" : "Role"} className="w-48">
                  {(field) => (
                    <Select
                      {...field}
                      value={inviteRole}
                      onChange={(e) =>
                        setInviteRole(e.target.value as "employee" | "admin" | "finance")
                      }
                    >
                      <option value="employee">
                        {locale === "hr" ? "Zaposlenik" : "Employee"}
                      </option>
                      <option value="admin">
                        {locale === "hr" ? "Administrator" : "Admin"}
                      </option>
                      <option value="finance">{locale === "hr" ? "Financije" : "Finance"}</option>
                    </Select>
                  )}
                </Field>
                <Button
                  onClick={() => void sendInvites()}
                  disabled={!inviteInput.trim()}
                  loading={inviteLoading}
                  icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                >
                  {t("company.team_invite_cta")}
                </Button>
              </div>
            </div>

            {inviteResult ? (
              <div className="mt-4 rounded-control border border-success/30 bg-success-soft p-4">
                <p className="mb-2 text-sm font-semibold text-success-on-soft">
                  {t("company.team_invite_sent")}
                </p>
                <ul className="space-y-2">
                  {inviteResult.map((invite) => (
                    <li key={invite.url} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-success-on-soft">
                        {invite.email}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void copyToken(invite.url)}
                        icon={
                          copiedToken === invite.url ? (
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          )
                        }
                      >
                        {copiedToken === invite.url ? t("common.copied") : t("common.copy")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {invites.length > 0 ? (
              <div className="mt-6">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                  {locale === "hr" ? "Pozivnice koje čekaju" : "Pending invites"}
                </h3>
                <ul className="space-y-2">
                  {invites.map((invite) => (
                    <li
                      key={invite.id}
                      className="flex items-center justify-between gap-3 rounded-control border border-border-subtle bg-surface-sunken px-4 py-2"
                    >
                      <span className="min-w-0 truncate text-sm text-ink">{invite.email}</span>
                      <time
                        dateTime={invite.expires_at}
                        className="shrink-0 text-xs tabular-nums text-ink-tertiary"
                      >
                        {new Date(invite.expires_at).toLocaleDateString(
                          locale === "hr" ? "hr-HR" : "en-US"
                        )}
                      </time>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        ) : null}

        {canManage ? (
          <Card padding="lg">
            <SectionHeader
              title={
                <span className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-brand" aria-hidden="true" />
                  {t("company.domain_title")}
                </span>
              }
              description={t("company.domain_instructions")}
            />

            <div className="mb-4 flex flex-wrap items-end gap-3">
              <Field
                label={locale === "hr" ? "Domena" : "Domain"}
                error={domainError}
                className="min-w-[14rem] flex-1"
              >
                {(field) => (
                  <Input
                    {...field}
                    type="text"
                    value={domainInput}
                    onChange={(e) => {
                      setDomainInput(e.target.value);
                      setDomainError(null);
                    }}
                    placeholder="firma.hr"
                    invalid={!!domainError}
                  />
                )}
              </Field>
              <Button
                onClick={() => void addDomain()}
                disabled={!domainInput.trim()}
                loading={domainLoading}
                icon={<Plus className="h-4 w-4" aria-hidden="true" />}
              >
                {t("common.submit")}
              </Button>
            </div>

            {domains.length > 0 ? (
              <ul className="space-y-3">
                {domains.map((d) => (
                  <li
                    key={d.id}
                    className="rounded-control border border-border-subtle bg-surface-sunken p-4"
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                      <span className="font-semibold text-ink">{d.domain}</span>
                      {d.verified_at ? (
                        <Badge
                          tone="success"
                          icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                        >
                          {locale === "hr" ? "Potvrđeno" : "Verified"}
                        </Badge>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void verifyDomain(d.id)}
                          loading={verifyingId === d.id}
                          icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                        >
                          {t("company.team_domain_verify_cta")}
                        </Button>
                      )}
                    </div>
                    {!d.verified_at ? (
                      <dl className="space-y-1 rounded-control bg-surface-raised p-3 font-mono text-xs">
                        <div className="flex gap-2">
                          <dt className="w-16 shrink-0 text-ink-tertiary">
                            {t("company.domain_record_host")}
                          </dt>
                          <dd className="text-ink">@</dd>
                        </div>
                        <div className="flex items-start gap-2">
                          <dt className="w-16 shrink-0 text-ink-tertiary">TXT</dt>
                          <dd className="flex min-w-0 flex-1 items-start gap-2">
                            <span className="min-w-0 break-all text-ink">{d.dns_token}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0"
                              onClick={() => void copyToken(d.dns_token)}
                            >
                              {copiedToken === d.dns_token ? t("common.copied") : t("common.copy")}
                            </Button>
                          </dd>
                        </div>
                      </dl>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}
      </div>

      <Dialog
        open={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        title={locale === "hr" ? "Ukloniti člana?" : "Remove this member?"}
        description={pendingRemoval?.profile?.email ?? pendingRemoval?.profile?.name ?? undefined}
        closeLabel={t("common.close")}
        footer={
          <>
            <Button
              variant="danger"
              onClick={() => void removeMember()}
              loading={removing}
              data-dialog-initial-focus
            >
              {t("common.delete")}
            </Button>
            <Button variant="secondary" onClick={() => setPendingRemoval(null)}>
              {t("common.cancel")}
            </Button>
          </>
        }
      />
    </div>
  );
}
