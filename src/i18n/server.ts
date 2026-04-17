import { cookies } from "next/headers";
import type { Locale } from "@/lib/types";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  format,
  getDictionary,
  resolveKey,
} from "./dictionaries";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  if (raw && (SUPPORTED_LOCALES as string[]).includes(raw)) {
    return raw as Locale;
  }
  return DEFAULT_LOCALE;
}

export async function t(key: string, vars?: Record<string, string | number>): Promise<string> {
  const locale = await getLocale();
  return format(resolveKey(getDictionary(locale), key), vars);
}

export async function getTranslator(): Promise<(key: string, vars?: Record<string, string | number>) => string> {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  return (key, vars) => format(resolveKey(dict, key), vars);
}
