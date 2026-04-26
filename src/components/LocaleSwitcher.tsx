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

  return (
    <div
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-1 py-1 text-xs font-medium shadow-sm",
        "dark:border-gray-700 dark:bg-gray-900"
      )}
      role="group"
      aria-label={locale === "hr" ? "Promijeni jezik" : "Change language"}
    >
      {!compact ? (
        <Languages className="ml-1 h-3.5 w-3.5 text-gray-500 dark:text-gray-400" aria-hidden="true" />
      ) : null}
      {(SUPPORTED_LOCALES as Locale[]).map((l) => {
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
              "rounded-full px-2 py-0.5 uppercase tracking-wide transition-colors disabled:cursor-default",
              active
                ? "bg-red-500 text-white"
                : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            )}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}
