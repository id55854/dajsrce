import hr from "./hr.json";
import en from "./en.json";
import type { Locale } from "@/lib/types";

export const dictionaries = { hr, en } as const;
export const LOCALE_COOKIE = "locale";
export const DEFAULT_LOCALE: Locale = "hr";
export const SUPPORTED_LOCALES: Locale[] = ["hr", "en"];

export type Dictionary = typeof hr;
export type TranslationKey = NestedKey<Dictionary>;

type NestedKey<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? NestedKey<T[K], `${Prefix}${K}.`>
    : `${Prefix}${K}`;
}[keyof T & string];

export function getDictionary(locale: Locale): Dictionary {
  return (dictionaries[locale] as Dictionary) ?? hr;
}

export function resolveKey(dict: Dictionary, key: string): string {
  const parts = key.split(".");
  let cursor: unknown = dict;
  for (const part of parts) {
    if (cursor && typeof cursor === "object" && part in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof cursor === "string" ? cursor : key;
}

export function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    vars[name] !== undefined ? String(vars[name]) : `{${name}}`
  );
}
