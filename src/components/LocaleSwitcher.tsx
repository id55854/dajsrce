"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import clsx from "clsx";
import { useLocale } from "@/i18n/client";
import { SUPPORTED_LOCALES } from "@/i18n/dictionaries";
import type { Locale } from "@/lib/types";
import { setLocaleAction } from "@/app/actions/locale";

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const locales = SUPPORTED_LOCALES as Locale[];
  const activeIndex = Math.max(0, locales.indexOf(locale));

  return (
    <div
      className="inline-flex items-center gap-1.5"
      role="group"
      aria-label={locale === "hr" ? "Promijeni jezik" : "Change language"}
      aria-busy={isPending || undefined}
    >
      {!compact ? (
        <Languages
          className="h-4 w-4 shrink-0 text-ink-tertiary"
          aria-hidden="true"
        />
      ) : null}

      <div
        className={clsx(
          "relative inline-flex rounded-full border border-border-subtle bg-surface-raised p-1 shadow-raised",
          "transition-opacity duration-150",
          isPending && "opacity-60"
        )}
      >
        {/* A single thumb that slides between segments, rather than two
            independent backgrounds crossfading — the selection keeps its
            identity as it moves. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-1 left-1 rounded-full bg-brand motion-safe:transition-transform motion-safe:duration-250 motion-safe:ease-out"
          style={{
            width: `calc((100% - 0.5rem) / ${locales.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />

        {locales.map((l) => {
          const active = l === locale;
          return (
            <button
              key={l}
              type="button"
              disabled={isPending || active}
              onClick={() => {
                // Optimistically flip the in-memory locale so client-only copy
                // (this component's aria-label, e.g.) updates immediately.
                setLocale(l);
                startTransition(async () => {
                  await setLocaleAction(l);
                  // Forces server components (which already reran via
                  // revalidatePath in the action) to reconcile with the client.
                  router.refresh();
                });
              }}
              aria-pressed={active}
              className={clsx(
                "relative z-10 min-w-10 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wide",
                "transition-colors duration-200 disabled:cursor-default",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                active ? "text-white" : "text-ink-secondary hover:text-ink"
              )}
            >
              {l}
            </button>
          );
        })}
      </div>
    </div>
  );
}
