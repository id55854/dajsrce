"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, HeartHandshake } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthActionDialog } from "@/components/AuthActionDialog";
import { useT } from "@/i18n/client";
import type { CompanyRole } from "@/lib/types";
import {
  Button,
  Dialog,
  Field,
  Input,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";

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

type CompanyOption = {
  id: string;
  legal_name: string;
  display_name: string | null;
  default_match_ratio: number;
  member_role: CompanyRole;
};

export function PledgeButton({ needId, needTitle, onPledge, onPledgeSuccess }: PledgeButtonProps) {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string>("me");
  const [requestMatch, setRequestMatch] = useState(false);
  const [amountEur, setAmountEur] = useState("");

  const closeModal = useCallback(() => {
    setOpen(false);
    setQuantity(1);
    setMessage("");
    setRequestMatch(false);
    setAmountEur("");
  }, []);

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
        // The API's `error` field is an internal, untranslated string (and the
        // old fallback rendered a raw `Error (500)` at the user). Neither
        // belongs on screen.
        toast({ tone: "error", title: t("common.error_generic") });
        return;
      }
      const responseBody = (await res.json().catch(() => null)) as PledgeSuccessPayload | null;
      toast({ tone: "success", title: t("pledge.success") });
      onPledge?.();
      if (responseBody) onPledgeSuccess?.(responseBody);
      closeModal();
    } catch {
      toast({ tone: "error", title: t("pledge.network_error") });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        aria-haspopup="dialog"
        aria-expanded={open}
        icon={<HeartHandshake className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
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
      >
        {t("pledge.cta")}
      </Button>

      <Dialog
        open={open}
        onClose={closeModal}
        title={t("pledge.dialog_title")}
        description={needTitle}
        closeLabel={t("common.close")}
        variant="sheet-on-mobile"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={loading}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} loading={loading} className="flex-1">
              {t("common.confirm")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {companies.length > 0 ? (
            <Field
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
                  {t("company.pledge_on_behalf_label")}
                </span>
              }
            >
              {(props) => (
                <Select
                  {...props}
                  value={selectedCompany}
                  onChange={(e) => {
                    setSelectedCompany(e.target.value);
                    setRequestMatch(false);
                  }}
                >
                  <option value="me">— ({t("pledge.personal")})</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.display_name || c.legal_name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          {showMatchOption ? (
            <label className="flex items-start gap-2.5 rounded-control bg-brand-soft p-3">
              <input
                type="checkbox"
                checked={requestMatch}
                onChange={(e) => setRequestMatch(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-brand-on-soft">
                  {t("company.pledge_match_label")}
                </span>
                <span className="block text-sm text-brand-on-soft/80">
                  {t("company.pledge_match_hint")}
                </span>
              </span>
            </label>
          ) : null}

          <Field label={t("pledge.quantity")}>
            {(props) => (
              <Input
                {...props}
                // Focus lands on the one control the user came here to set,
                // not on the dismissive close button.
                data-dialog-initial-focus
                type="number"
                min={1}
                value={quantity}
                onChange={(e) =>
                  setQuantity(Math.max(1, Number(e.target.value) || 1))
                }
              />
            )}
          </Field>

          <Field label={t("pledge.amount_eur_label")} hint={t("pledge.amount_eur_hint")}>
            {(props) => (
              <Input
                {...props}
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={amountEur}
                onChange={(e) => setAmountEur(e.target.value)}
              />
            )}
          </Field>

          <Field label={t("pledge.message_optional")}>
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                className="resize-none"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Dialog>

      <AuthActionDialog
        open={authDialogOpen}
        onClose={() => setAuthDialogOpen(false)}
        actionLabel={t("pledge.auth_action")}
        nextPath={`/needs`}
      />
    </>
  );
}
