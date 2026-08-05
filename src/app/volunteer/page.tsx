import type { Metadata } from "next";
import { getTranslator } from "@/i18n/server";
import { VolunteerClient } from "./volunteer-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return {
    title: `${t("volunteer_page.title")} | DajSrce`,
    description: t("volunteer_page.subtitle"),
  };
}

export default function VolunteerPage() {
  return <VolunteerClient />;
}
