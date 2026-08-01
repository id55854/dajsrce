"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useId, useRef } from "react";
import { useT } from "@/i18n/client";
import { useDialogFocus } from "@/lib/use-dialog-focus";

type AuthActionDialogProps = {
  open: boolean;
  actionLabel: string;
  onClose: () => void;
  nextPath: string;
};

export function AuthActionDialog({
  open,
  actionLabel,
  onClose,
  nextPath,
}: AuthActionDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const t = useT();
  useDialogFocus({ open, dialogRef, onClose });

  const loginHref = `/auth/login?next=${encodeURIComponent(nextPath)}`;
  const registerHref = `/auth/register?next=${encodeURIComponent(nextPath)}`;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl outline-none dark:bg-gray-900"
      >
        <div className="flex items-start justify-between gap-4">
          <h3 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("auth_dialog.title")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <p id={descriptionId} className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {t("auth_dialog.body", { action: actionLabel.toLowerCase() })}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href={loginHref}
            className="inline-flex flex-1 items-center justify-center rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600"
          >
            {t("nav.sign_in")}
          </Link>
          <Link
            href={registerHref}
            className="inline-flex flex-1 items-center justify-center rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t("auth_dialog.register")}
          </Link>
        </div>
      </div>
    </div>
  );
}
