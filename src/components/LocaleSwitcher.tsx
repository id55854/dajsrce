"use client";

import { Languages } from "lucide-react";
import clsx from "clsx";
import { useLocale } from "@/i18n/client";
import { SUPPORTED_LOCALES } from "@/i18n/dictionaries";
import type { Locale } from "@/lib/types";

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale();

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
            onClick={() => {
              setLocale(l);
              // Force a server re-render so server-rendered copy updates.
              if (typeof window !== "undefined") window.location.reload();
            }}
            aria-pressed={active}
            className={clsx(
              "rounded-full px-2 py-0.5 uppercase tracking-wide transition-colors",
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
