import type { Metadata } from "next";
import { getTranslator } from "@/i18n/server";
import { OffersInboxClient } from "./offers-inbox-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return {
    title: `${t("offers_inbox.title")} | DajSrce`,
    description: t("offers_inbox.subtitle"),
    // Only verified organisation members may read this; never index it.
    robots: { index: false, follow: false },
  };
}

export default function OffersInboxPage() {
  return <OffersInboxClient />;
}
