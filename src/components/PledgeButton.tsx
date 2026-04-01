"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { HeartHandshake, Loader2, X } from "lucide-react";
import clsx from "clsx";

type PledgeButtonProps = {
  needId: string;
  needTitle: string;
  onPledge?: () => void;
};

type ToastState = { type: "success" | "error"; message: string } | null;

export function PledgeButton({ needId, needTitle, onPledge }: PledgeButtonProps) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const titleId = useId();
  const descId = useId();

  const closeModal = useCallback(() => {
    setOpen(false);
    setQuantity(1);
    setMessage("");
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeModal]);

  const submit = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pledges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          need_id: needId,
          quantity,
          message: message.trim() || undefined,
        }),
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
      setToast({ type: "success", message: "Thank you! Your pledge has been recorded." });
      onPledge?.();
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
        onClick={() => setOpen(true)}
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
    </>
  );
}
