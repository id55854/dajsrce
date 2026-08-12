import type { Metadata } from "next";
import { getTranslator } from "@/i18n/server";
import { OffersClient } from "./offers-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return {
    title: `${t("offers.title")} | DajSrce`,
    description: t("offers.subtitle"),
    // An offer belongs to a private individual; nothing here should be indexed.
    robots: { index: false, follow: false },
  };
}

export default function OffersPage() {
  return <OffersClient />;
}
