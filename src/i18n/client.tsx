"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Locale } from "@/lib/types";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  format,
  getDictionary,
  resolveKey,
} from "./dictionaries";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale?: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(
    initialLocale && (SUPPORTED_LOCALES as string[]).includes(initialLocale)
      ? initialLocale
      : DEFAULT_LOCALE
  );

  const setLocale = useCallback((next: Locale) => {
    if (!(SUPPORTED_LOCALES as string[]).includes(next)) return;
    setLocaleState(next);
    if (typeof document !== "undefined") {
      // 1-year cookie, lax same-site, path=/ so server t() picks it up too.
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
      document.documentElement.lang = next;
    }
  }, []);

  const value = useMemo<LocaleContextValue>(() => {
    const dict = getDictionary(locale);
    return {
      locale,
      setLocale,
      t: (key, vars) => format(resolveKey(dict, key), vars),
    };
  }, [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT(): LocaleContextValue["t"] {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    // Graceful fallback so components that render outside the provider
    // don't crash during an SSR mismatch window.
    return (key) => key;
  }
  return ctx.t;
}

export function useLocale(): { locale: Locale; setLocale: (next: Locale) => void } {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    return { locale: DEFAULT_LOCALE, setLocale: () => {} };
  }
  return { locale: ctx.locale, setLocale: ctx.setLocale };
}
