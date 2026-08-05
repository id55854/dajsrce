"use client";

import type { ReactNode } from "react";
import { useId, useRef } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { usePresence } from "./use-presence";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Announced with the title. Pass a node when the body needs framing. */
  description?: ReactNode;
  /** Accessible name for the close control. */
  closeLabel: string;
  footer?: ReactNode;
  /** Renders flush to the bottom edge on small screens. */
  variant?: "centered" | "sheet-on-mobile";
  children?: ReactNode;
};

/**
 * Modal surface with symmetric enter/exit motion, a focus trap, scroll lock
 * and Escape-to-dismiss (the last three come from `useDialogFocus`).
 *
 * Mark the primary action inside with `data-dialog-initial-focus` so focus
 * lands on the useful control rather than on the close button.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  closeLabel,
  footer,
  variant = "centered",
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const { present, state, onAnimationEnd } = usePresence(open);

  useDialogFocus({ open, dialogRef: panelRef, onClose });

  if (!present) return null;

  const asSheet = variant === "sheet-on-mobile";

  return (
    <div
      data-ui-motion
      data-state={state}
      onAnimationEnd={onAnimationEnd}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={clsx(
        "fixed inset-0 z-[var(--z-modal)] flex justify-center bg-scrim p-4",
        "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
        asSheet ? "items-end sm:items-center" : "items-center"
      )}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className={clsx(
          "w-full max-w-md border border-border-subtle bg-surface-overlay p-6 shadow-modal outline-none",
          asSheet ? "rounded-sheet sm:rounded-card" : "rounded-card",
          asSheet
            ? "data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out sm:data-[state=open]:animate-dialog-in sm:data-[state=closed]:animate-dialog-out"
            : "data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out"
        )}
        data-state={state}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold leading-snug text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-base text-ink-secondary">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="-mr-2 -mt-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {children ? <div className="mt-4">{children}</div> : null}
        {footer ? <div className="mt-6 flex gap-3">{footer}</div> : null}
      </div>
    </div>
  );
}
