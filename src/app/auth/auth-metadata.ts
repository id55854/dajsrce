import type { Metadata } from "next";
import { getTranslator } from "@/i18n/server";

/**
 * The auth pages are client components and cannot export metadata, so each
 * route has a pass-through layout that calls this for its own tab title.
 */
export async function authPageMetadata(titleKey: string): Promise<Metadata> {
  const t = await getTranslator();
  return { title: `${t(titleKey)} | DajSrce` };
}
