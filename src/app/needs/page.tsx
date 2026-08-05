import type { Metadata } from "next";
import { getTranslator } from "@/i18n/server";
import { NeedsClient } from "./needs-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return {
    title: `${t("needs_page.title")} | DajSrce`,
    description: t("needs_page.subtitle"),
  };
}

export default function NeedsPage() {
  return <NeedsClient />;
}
