"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Globe, Loader2, Mail, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useT, useLocale } from "@/i18n/client";
import { COMPANY_ROLE_LABELS } from "@/lib/constants";
import type {
  CompanyDomain,
  CompanyInvite,
  CompanyMember,
  CompanyRole,
} from "@/lib/types";

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
  const canManage = myRole === "owner" || myRole === "admin";

  const [inviteInput, setInviteInput] = useState("");
  const [inviteRole, setInviteRole] = useState<"employee" | "admin" | "finance">("employee");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ email: string; url: string }[] | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [domainInput, setDomainInput] = useState("");
  const [domainLoading, setDomainLoading] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  async function sendInvites() {
    setInviteError(null);
    setInviteResult(null);
    setInviteLoading(true);
    try {
      const emails = inviteInput
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (emails.length === 0) {
        setInviteError(t("common.error_generic"));
        return;
      }
      const res = await fetch(`/api/companies/${companyId}/invites`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error ?? t("common.error_generic"));
        return;
      }
      setInviteResult(
        (data.invites as Array<{ email: string; accept_url: string }>).map((i) => ({
          email: i.email,
          url: i.accept_url,
        }))
      );
      setInviteInput("");
      router.refresh();
    } finally {
      setInviteLoading(false);
    }
  }

  async function addDomain() {
    setDomainLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/domains`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domainInput.trim() }),
      });
      if (res.ok) {
        setDomainInput("");
        router.refresh();
      }
    } finally {
      setDomainLoading(false);
    }
  }

  async function verifyDomain(domainId: string) {
    setVerifyingId(domainId);
    try {
      await fetch(`/api/companies/${companyId}/domains/${domainId}/verify`, {
        method: "POST",
        credentials: "include",
      });
      router.refresh();
    } finally {
      setVerifyingId(null);
    }
  }

  async function removeMember(profileId: string) {
    const confirmed = window.confirm(locale === "hr" ? "Ukloniti člana?" : "Remove this member?");
    if (!confirmed) return;
    const res = await fetch(`/api/companies/${companyId}/members/${profileId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) router.refresh();
  }

  async function copyToken(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedToken(value);
      setTimeout(() => setCopiedToken(null), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("company.team_title")}
          </h2>
          <span className="text-xs text-gray-500">
            {members.length} {locale === "hr" ? "članova" : "members"}
          </span>
        </header>

        {members.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t("company.team_empty")}</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {members.map((m) => {
              const role = COMPANY_ROLE_LABELS[m.role];
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                      {m.profile?.name ?? "—"}
                    </p>
                    <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {m.profile?.email ?? ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                      {locale === "hr" ? role.labelHr : role.label}
                    </span>
                    {canManage && m.role !== "owner" ? (
                      <button
                        type="button"
                        onClick={() => removeMember(m.profile_id)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                        aria-label="Remove member"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canManage ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <header className="mb-4 flex items-center gap-2">
            <Mail className="h-4 w-4 text-red-500" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("company.team_invite_cta")}
            </h2>
          </header>

          <div className="space-y-3">
            <textarea
              rows={2}
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              placeholder="ana@firma.hr, ivan@firma.hr"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "employee" | "admin" | "finance")}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="employee">{locale === "hr" ? "Zaposlenik" : "Employee"}</option>
                <option value="admin">{locale === "hr" ? "Administrator" : "Admin"}</option>
                <option value="finance">{locale === "hr" ? "Financije" : "Finance"}</option>
              </select>
              <button
                type="button"
                onClick={sendInvites}
                disabled={inviteLoading || !inviteInput.trim()}
                className="inline-flex items-center gap-1.5 rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-600 disabled:opacity-50"
              >
                {inviteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {t("company.team_invite_cta")}
              </button>
            </div>
          </div>

          {inviteError ? (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
              {inviteError}
            </p>
          ) : null}

          {inviteResult ? (
            <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30">
              <p className="mb-2 font-semibold text-emerald-800 dark:text-emerald-300">
                {t("company.team_invite_sent")}
              </p>
              <ul className="space-y-2">
                {inviteResult.map((invite) => (
                  <li key={invite.url} className="flex items-center gap-2">
                    <span className="truncate font-mono text-xs text-emerald-900 dark:text-emerald-200">
                      {invite.email}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyToken(invite.url)}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-semibold text-emerald-700 shadow hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-200"
                    >
                      {copiedToken === invite.url ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copiedToken === invite.url ? t("common.copied") : t("common.copy")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {invites.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {locale === "hr" ? "Pozivnice koje čekaju" : "Pending invites"}
              </p>
              <ul className="space-y-1 text-xs">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-gray-600 dark:text-gray-400">{invite.email}</span>
                    <span className="text-gray-400">
                      {new Date(invite.expires_at).toLocaleDateString(locale === "hr" ? "hr-HR" : "en-US")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {canManage ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <header className="mb-4 flex items-center gap-2">
            <Globe className="h-4 w-4 text-red-500" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("company.domain_title")}
            </h2>
          </header>

          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            {t("company.domain_instructions")}
          </p>

          <div className="mb-4 flex gap-2">
            <input
              type="text"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="firma.hr"
              className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
            <button
              type="button"
              onClick={addDomain}
              disabled={domainLoading || !domainInput.trim()}
              className="rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
            >
              {domainLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </button>
          </div>

          {domains.length > 0 ? (
            <ul className="space-y-3 text-sm">
              {domains.map((d) => (
                <li
                  key={d.id}
                  className="rounded-xl border border-gray-100 p-3 dark:border-gray-800"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{d.domain}</span>
                    {d.verified_at ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <ShieldCheck className="h-3 w-3" />
                        {locale === "hr" ? "Potvrđeno" : "Verified"}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => verifyDomain(d.id)}
                        disabled={verifyingId === d.id}
                        className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50 dark:bg-red-950/40 dark:text-red-300"
                      >
                        {verifyingId === d.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        {t("company.team_domain_verify_cta")}
                      </button>
                    )}
                  </div>
                  {!d.verified_at ? (
                    <div className="space-y-1 rounded-lg bg-gray-50 p-2 font-mono text-xs dark:bg-gray-800/60">
                      <div className="flex gap-2">
                        <span className="w-16 shrink-0 text-gray-500">{t("company.domain_record_host")}</span>
                        <span className="text-gray-800 dark:text-gray-200">@</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="w-16 shrink-0 text-gray-500">TXT</span>
                        <span className="break-all text-gray-800 dark:text-gray-200">{d.dns_token}</span>
                        <button
                          type="button"
                          onClick={() => copyToken(d.dns_token)}
                          className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 shadow hover:bg-gray-100 dark:bg-gray-900"
                        >
                          {copiedToken === d.dns_token ? t("common.copied") : t("common.copy")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
