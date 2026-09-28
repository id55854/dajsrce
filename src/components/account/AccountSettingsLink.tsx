"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { buttonClasses } from "@/components/ui";
import { useT } from "@/i18n/client";

/** Next to sign-out on every dashboard: the way to the account settings. */
export function AccountSettingsLink() {
  const t = useT();
  return (
    <Link href="/dashboard/postavke" className={buttonClasses({ variant: "secondary" })}>
      <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
      {t("account.settings_link")}
    </Link>
  );
}
