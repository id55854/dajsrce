"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
} from "@/i18n/dictionaries";
import type { Locale } from "@/lib/types";

export async function setLocaleAction(next: string): Promise<Locale> {
  const valid = (SUPPORTED_LOCALES as string[]).includes(next)
    ? (next as Locale)
    : DEFAULT_LOCALE;
  const store = await cookies();
  store.set(LOCALE_COOKIE, valid, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
  return valid;
}
