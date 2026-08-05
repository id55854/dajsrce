"use client";

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import clsx from "clsx";
import { usePresence } from "./use-presence";

export type ToastTone = "success" | "error" | "warning" | "info";

export type ToastOptions = {
  tone?: ToastTone;
  title: string;
  description?: string;
  /** Milliseconds before auto-dismiss. Errors default to a longer read. */
  duration?: number;
};

type ToastRecord = ToastOptions & {
  id: number;
  tone: ToastTone;
  open: boolean;
};

const ToastContext = createContext<((options: ToastOptions) => void) | null>(
  null
);

/**
 * The app-wide feedback channel. Replaces the pattern where a successful
 * mutation reported nothing at all and a failure surfaced as an inline string
 * styled identically to a success message.
 */
export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return toast;
}

const TONES: Record<ToastTone, { className: string; icon: ReactNode }> = {
  success: {
    className: "border-success/30 bg-success-soft text-success-on-soft",
    icon: <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />,
  },
  error: {
    className: "border-danger/30 bg-danger-soft text-danger-on-soft",
    icon: <XCircle className="h-5 w-5 text-danger" aria-hidden="true" />,
  },
  warning: {
    className: "border-warning/30 bg-warning-soft text-warning-on-soft",
    icon: (
      <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
    ),
  },
  info: {
    className: "border-info/30 bg-info-soft text-info-on-soft",
    icon: <Info className="h-5 w-5 text-info" aria-hidden="true" />,
  },
};

function ToastItem({
  record,
  onDismiss,
  onRemove,
}: {
  record: ToastRecord;
  onDismiss: () => void;
  onRemove: () => void;
}) {
  const { present, state, onAnimationEnd } = usePresence(record.open);
  const tone = TONES[record.tone];

  // Drop the record once the exit animation has finished playing.
  useEffect(() => {
    if (!present) onRemove();
  }, [onRemove, present]);

  if (!present) return null;

  return (
    <div
      data-ui-motion
      data-state={state}
      onAnimationEnd={onAnimationEnd}
      onClick={onDismiss}
      className={clsx(
        "pointer-events-auto w-full max-w-sm cursor-pointer rounded-card border px-4 py-3 shadow-overlay",
        "data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out",
        tone.className
      )}
    >
      <div className="flex items-start gap-3">
        {tone.icon}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{record.title}</p>
          {record.description ? (
            <p className="mt-0.5 text-sm opacity-90">{record.description}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<ToastRecord[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, open: false } : r))
    );
  }, []);

  const remove = useCallback((id: number) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const toast = useCallback(
    ({ tone = "info", title, description, duration }: ToastOptions) => {
      const id = nextId.current++;
      const ttl = duration ?? (tone === "error" ? 7000 : 4000);
      setRecords((prev) => [
        // Cap the stack so a burst of failures cannot bury the whole screen.
        ...prev.slice(-2),
        { id, tone, title, description, open: true },
      ]);
      window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss]
  );

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // Assertive would interrupt; these are confirmations, not alarms. The
        // error tone still reads promptly because the region is always present.
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[var(--z-toast)] flex flex-col items-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {records.map((record) => (
          <ToastItem
            key={record.id}
            record={record}
            onDismiss={() => dismiss(record.id)}
            onRemove={() => remove(record.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
