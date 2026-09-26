import type { Metadata } from "next";
import { getTranslator } from "@/i18n/server";
import { isUuid } from "@/lib/security/http";
import { VolunteerClient } from "./volunteer-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return {
    title: `${t("volunteer_page.title")} | DajSrce`,
    description: t("volunteer_page.subtitle"),
  };
}

/**
 * `?event=<id>` opens that event: it is where sign-in returns a visitor who
 * tried to join before signing in, and a link that can be shared.
 */
export default async function VolunteerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { event } = await searchParams;
  return <VolunteerClient focusEventId={isUuid(event) ? event : null} />;
}
