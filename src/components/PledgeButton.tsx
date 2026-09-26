"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, HeartHandshake } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { AuthActionDialog } from "@/components/AuthActionDialog";
import {
  PledgeHandover,
  type PledgeHandoverInstitution,
} from "@/components/PledgeDetailsDialog";
import { useT } from "@/i18n/client";
import type { CapacityErrorCode } from "@/lib/capacity-errors";
import {
  PLEDGE_AMOUNT_EUR_MAX,
  PLEDGE_MESSAGE_MAX,
  clearPledgeIntent,
  needAnchorId,
  pledgeIntentFrom,
  pledgeQuantityCap,
  pledgeReturnPath,
} from "@/lib/pledge-flow";
import {
  Button,
  Dialog,
  Field,
  Input,
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
    /** Written by the API, shown to nobody; see YourPledgesSection. */
    status?: string | null;
    amount_eur: number | null;
    created_at: string;
  };
  match_pledge_id: string | null;
  need: { id: string; quantity_pledged: number } | null;
  /** Who to contact and where to bring things; null if the lookup failed. */
  institution?: PledgeHandoverInstitution | null;
};

type PledgeButtonProps = {
  needId: string;
  needTitle: string;
  /**
   * What the card already knows about the organisation, shown in the
   * confirmation if the API's handover lookup came back empty.
   */
  institution?: PledgeHandoverInstitution | null;
  onPledge?: () => void;
  /**
   * Called after a successful POST /api/pledges, with the parsed response
   * body. Parent patches its local needs[] state from `payload.need` and
   * appends `payload.pledge` to its userPledges list.
   */
  onPledgeSuccess?: (payload: PledgeSuccessPayload) => void;
  /**
   * Units still needed, or null when the need has no target. The dialog caps
   * the quantity at it; the pledge RPC enforces the same limit under a lock.
   */
  remaining?: number | null;
  /** The need is fully pledged: the button stays visible but cannot open. */
  full?: boolean;
  /** The server refused for capacity; the card refreshes its counts. */
  onCapacityError?: (code: CapacityErrorCode) => void;
};

export function PledgeButton({
  needId,
  needTitle,
  institution = null,
  onPledge,
  onPledgeSuccess,
  remaining = null,
  full = false,
  onCapacityError,
}: PledgeButtonProps) {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // Held as raw text, like `amountEur` below. A numeric state clamped on every
  // keystroke cannot be emptied: backspacing the last digit yields "", which
  // clamps straight back to 1 and React re-renders the digit, so the field only
  // ever grows a second digit. Parsing is deferred to blur and submit.
  const [quantity, setQuantity] = useState("1");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  // Where signing in returns to: this page (or the giving page), naming this
  // need so its dialog reopens. Computed on click, when the page is known.
  const [authNextPath, setAuthNextPath] = useState("/doniraj");
  const [amountEur, setAmountEur] = useState("");
  /**
   * Set once the pledge is recorded: the dialog stays open and turns into
   * "what now", because a toast that says thanks and then vanishes left the
   * donor with a promise and no idea whom to call or where to go.
   */
  const [confirmed, setConfirmed] = useState<{
    institution: PledgeHandoverInstitution | null;
    quantity: number;
  } | null>(null);
  const confirmedHeadingRef = useRef<HTMLParagraphElement>(null);

  const closeModal = useCallback(() => {
    setOpen(false);
    setConfirmed(null);
    setQuantity("1");
    setMessage("");
    setAmountEur("");
  }, []);

  // The confirm button the focus sat on is gone once the dialog turns into
  // the confirmation, so focus moves to the confirmation itself.
  useEffect(() => {
    if (confirmed) confirmedHeadingRef.current?.focus();
  }, [confirmed]);

  // Back from signing in with `?pledge=<this need>`: finish what the donor
  // started. The intent is cleared first so a reload does not reopen it.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (pledgeIntentFrom(window.location.search) !== needId.toLowerCase()) return;
    let cancelled = false;
    createClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (cancelled || !session?.user) return;
        clearPledgeIntent();
        if (full) {
          toast({ tone: "info", title: t("pledge.full_now") });
          return;
        }
        document.getElementById(needAnchorId(needId))?.scrollIntoView({ block: "center" });
        setOpen(true);
      })
      .catch(() => {
        // Without a readable session the button still works as usual.
      });
    return () => {
      cancelled = true;
    };
  }, [needId, full, t, toast]);

  /**
   * At least one whole unit and never more than is still needed; an empty or
   * junk field means a single unit.
   */
  const maxQuantity = remaining != null && remaining > 0 ? remaining : null;
  const quantityCap = pledgeQuantityCap(remaining);
  const parsedQuantity = Math.min(quantityCap, Math.max(1, Math.floor(Number(quantity) || 1)));
  // An estimate, never a bill: blank or zero sends nothing, a figure beyond
  // the cap is refused here rather than by a generic error from the API.
  const eurParsed = Number.parseFloat(amountEur.replace(/\s/g, "").replace(",", "."));
  const amountTooHigh = Number.isFinite(eurParsed) && eurParsed > PLEDGE_AMOUNT_EUR_MAX;

  const submit = async () => {
    if (amountTooHigh) return;
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        need_id: needId,
        quantity: parsedQuantity,
        message: message.trim() || undefined,
      };
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
        // belongs on screen; the stable `code` does.
        const body = (await res.json().catch(() => null)) as { code?: CapacityErrorCode } | null;
        if (body?.code === "need_fulfilled" || body?.code === "exceeds_remaining") {
          toast({
            tone: "error",
            title: t(body.code === "need_fulfilled" ? "pledge.full_now" : "pledge.exceeds_remaining"),
          });
          onCapacityError?.(body.code);
          if (body.code === "need_fulfilled") closeModal();
          return;
        }
        toast({ tone: "error", title: t("common.error_generic") });
        return;
      }
      const responseBody = (await res.json().catch(() => null)) as PledgeSuccessPayload | null;
      setConfirmed({
        institution: responseBody?.institution ?? institution,
        quantity: responseBody?.pledge?.quantity ?? parsedQuantity,
      });
      onPledge?.();
      if (responseBody) onPledgeSuccess?.(responseBody);
    } catch {
      toast({ tone: "error", title: t("pledge.network_error") });
    } finally {
      setLoading(false);
    }
  };

  // The dialogs below stay mounted when the need turns full: the donor's own
  // pledge can be the one that fills it, and the confirmation must not vanish
  // along with the button.
  const trigger = full ? (
    <Button
      disabled
      variant="secondary"
      icon={<HeartHandshake className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
    >
      {t("pledge.full")}
    </Button>
  ) : (
    <Button
      aria-haspopup="dialog"
      aria-expanded={open}
      icon={<HeartHandshake className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
      onClick={async () => {
        const supabase = createClient();
        // UI gating only (open the dialog or ask to sign in), so the local
        // session is enough; the pledge API re-verifies the token itself.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user) {
          setAuthNextPath(pledgeReturnPath(window.location, needId));
          setAuthDialogOpen(true);
          return;
        }
        setOpen(true);
      }}
    >
      {t("pledge.cta")}
    </Button>
  );

  return (
    <>
      {trigger}

      <Dialog
        open={open}
        onClose={closeModal}
        title={confirmed ? t("pledge.success") : t("pledge.dialog_title")}
        description={needTitle}
        closeLabel={t("common.close")}
        variant="sheet-on-mobile"
        footer={
          confirmed ? (
            <Button onClick={closeModal} className="flex-1">
              {t("pledge.done")}
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={closeModal} disabled={loading}>
                {t("common.cancel")}
              </Button>
              <Button onClick={submit} loading={loading} disabled={amountTooHigh} className="flex-1">
                {t("common.confirm")}
              </Button>
            </>
          )
        }
      >
        {confirmed ? (
          <div className="space-y-4">
            <p
              ref={confirmedHeadingRef}
              tabIndex={-1}
              className="flex items-center gap-2 text-base text-ink outline-none"
            >
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
              {t("pledge.success_quantity", { qty: confirmed.quantity })}
            </p>
            <PledgeHandover institution={confirmed.institution} />
          </div>
        ) : (
          <div className="space-y-4">
            <Field
              label={t("pledge.quantity")}
              hint={
                maxQuantity != null && maxQuantity <= quantityCap
                  ? t("pledge.remaining_hint", { remaining: maxQuantity })
                  : t("pledge.quantity_max_hint", { max: quantityCap.toLocaleString("hr-HR") })
              }
            >
              {(props) => (
                <Input
                  {...props}
                  // Focus lands on the one control the user came here to set,
                  // not on the dismissive close button.
                  data-dialog-initial-focus
                  type="number"
                  min={1}
                  max={quantityCap}
                  step={1}
                  inputMode="numeric"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  // Leaving the field empty is fine while typing, but not once
                  // focus moves on: normalise so what is submitted is what the
                  // user can see.
                  onBlur={() => setQuantity(String(parsedQuantity))}
                />
              )}
            </Field>

            <Field
              label={t("pledge.amount_eur_label")}
              hint={t("pledge.amount_eur_hint")}
              error={
                amountTooHigh
                  ? t("pledge.amount_eur_too_high", { max: PLEDGE_AMOUNT_EUR_MAX.toLocaleString("hr-HR") })
                  : undefined
              }
            >
              {(props) => (
                <Input
                  {...props}
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  invalid={amountTooHigh}
                  value={amountEur}
                  onChange={(e) => setAmountEur(e.target.value)}
                />
              )}
            </Field>

            <Field label={t("pledge.message_optional")} hint={t("pledge.message_hint")}>
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  maxLength={PLEDGE_MESSAGE_MAX}
                  className="resize-none"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              )}
            </Field>

            {/* Said before the promise is made, not after: the organisation
                sees who pledged so it can arrange the handover. */}
            <p className="text-sm text-ink-secondary">
              {t("pledge.disclosure")}{" "}
              <a
                href="/pravila-privatnosti"
                target="_blank"
                rel="noopener"
                className="font-semibold text-brand underline-offset-2 hover:underline"
              >
                {t("pledge.privacy_link")}
              </a>
            </p>
          </div>
        )}
      </Dialog>

      <AuthActionDialog
        open={authDialogOpen}
        onClose={() => setAuthDialogOpen(false)}
        actionLabel={t("pledge.auth_action")}
        nextPath={authNextPath}
      />
    </>
  );
}
