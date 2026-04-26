"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Building2, HeartHandshake, Loader2, X } from "lucide-react";
import clsx from "clsx";
import { createClient } from "@/lib/supabase/client";
import { AuthActionDialog } from "@/components/AuthActionDialog";
import { useT } from "@/i18n/client";
import type { CompanyRole } from "@/lib/types";

/**
 * Subset of `/api/pledges` POST response that the parent uses to patch its
 * needs[] state and append to "Your pledges" without a page refresh. Mirrors
 * the volunteer-card pattern in src/components/VolunteerEventCard.tsx.
 */
export type PledgeSuccessPayload = {
  pledge: {
    id: string;
    user_id: string;
    need_id: string;
    quantity: number;
    message: string | null;
    status: "pledged" | "delivered" | "confirmed" | "cancelled";
    amount_eur: number | null;
    created_at: string;
  };
  match_pledge_id: string | null;
  need: { id: string; quantity_pledged: number } | null;
};

type PledgeButtonProps = {
  needId: string;
  needTitle: string;
  onPledge?: () => void;
  /**
   * Called after a successful POST /api/pledges, with the parsed response
   * body. Parent patches its local needs[] state from `payload.need` and
   * appends `payload.pledge` to its userPledges list.
   */
  onPledgeSuccess?: (payload: PledgeSuccessPayload) => void;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type CompanyOption = {
  id: string;
  legal_name: string;
  display_name: string | null;
  default_match_ratio: number;
  member_role: CompanyRole;
};

export function PledgeButton({ needId, needTitle, onPledge, onPledgeSuccess }: PledgeButtonProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string>("me");
  const [requestMatch, setRequestMatch] = useState(false);
  const [amountEur, setAmountEur] = useState("");
  const titleId = useId();
  const descId = useId();

  const closeModal = useCallback(() => {
    setOpen(false);
    setQuantity(1);
    setMessage("");
    setRequestMatch(false);
    setAmountEur("");
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeModal]);

  // Load company memberships once the modal first opens.
  useEffect(() => {
    if (!open || companies.length > 0) return;
    fetch("/api/companies", { credentials: "include" })
      .then((r) => r.json())
      .then((data: { companies?: Array<{ id: string; legal_name: string; display_name: string | null; default_match_ratio: number; member_role: CompanyRole }> }) => {
        setCompanies(
          (data.companies ?? []).map((c) => ({
            id: c.id,
            legal_name: c.legal_name,
            display_name: c.display_name,
            default_match_ratio: Number(c.default_match_ratio ?? 0),
            member_role: c.member_role,
          }))
        );
      })
      .catch(() => {});
  }, [open, companies.length]);

  const activeCompany = companies.find((c) => c.id === selectedCompany) ?? null;
  const showMatchOption = activeCompany ? activeCompany.default_match_ratio > 0 : false;

  const submit = async () => {
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        need_id: needId,
        quantity,
        message: message.trim() || undefined,
      };
      if (selectedCompany !== "me") {
        payload.company_id = selectedCompany;
        payload.request_match = requestMatch;
      }
      const eurParsed = Number.parseFloat(amountEur.replace(",", "."));
      if (Number.isFinite(eurParsed) && eurParsed > 0) {
        payload.amount_eur = Math.round(eurParsed * 100) / 100;
      }
      const res = await fetch("/api/pledges", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg =
          typeof err?.error === "string"
            ? err.error
            : `Error (${res.status})`;
        setToast({ type: "error", message: msg });
        return;
      }
      const responseBody = (await res.json().catch(() => null)) as PledgeSuccessPayload | null;
      setToast({ type: "success", message: "Thank you! Your pledge has been recorded." });
      onPledge?.();
      if (responseBody) onPledgeSuccess?.(responseBody);
      closeModal();
    } catch {
      setToast({
        type: "error",
        message: "Network error. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const supabase = createClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) {
            setAuthDialogOpen(true);
            return;
          }
          setOpen(true);
        }}
        className="inline-flex items-center gap-2 rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
      >
        <HeartHandshake className="h-4 w-4" strokeWidth={2} />
        I can help
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2
                id={titleId}
                className="text-lg font-semibold text-gray-900 dark:text-gray-100"
              >
                Pledge help
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p id={descId} className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              {needTitle}
            </p>

            {companies.length > 0 ? (
              <label className="mb-4 block text-sm font-medium text-gray-700 dark:text-gray-300">
                <span className="mb-1 inline-flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-red-500" aria-hidden="true" />
                  {t("company.pledge_on_behalf_label")}
                </span>
                <select
                  value={selectedCompany}
                  onChange={(e) => {
                    setSelectedCompany(e.target.value);
                    setRequestMatch(false);
                  }}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="me">— (personal)</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name || c.legal_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {showMatchOption ? (
              <label className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm dark:bg-red-950/30">
                <input
                  type="checkbox"
                  checked={requestMatch}
                  onChange={(e) => setRequestMatch(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-red-500"
                />
                <span>
                  <span className="block font-semibold text-red-800 dark:text-red-200">
                    {t("company.pledge_match_label")}
                  </span>
                  <span className="block text-xs text-red-700/90 dark:text-red-300/80">
                    {t("company.pledge_match_hint")}
                  </span>
                </span>
              </label>
            ) : null}

            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Quantity
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) =>
                  setQuantity(Math.max(1, Number(e.target.value) || 1))
                }
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>

            <label className="mt-4 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("pledge.amount_eur_label")}
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={amountEur}
                onChange={(e) => setAmountEur(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
              <span className="mt-1 block text-xs font-normal text-gray-500">{t("pledge.amount_eur_hint")}</span>
            </label>

            <label className="mt-4 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Message (optional)
              <textarea
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="mt-1 w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-gray-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={loading}
                className="rounded-full border-2 border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          className={clsx(
            "fixed bottom-4 left-1/2 z-[110] max-w-sm -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg",
            toast.type === "success"
              ? "bg-emerald-600 text-white"
              : "bg-red-600 text-white"
          )}
          role="status"
        >
          {toast.message}
        </div>
      ) : null}
      <AuthActionDialog
        open={authDialogOpen}
        onClose={() => setAuthDialogOpen(false)}
        actionLabel="Donate / offer help"
        nextPath={`/needs`}
      />
    </>
  );
}
