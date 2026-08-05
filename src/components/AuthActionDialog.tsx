"use client";

import Link from "next/link";
import { useT } from "@/i18n/client";
import { Dialog, buttonClasses } from "@/components/ui";

type AuthActionDialogProps = {
  open: boolean;
  actionLabel: string;
  onClose: () => void;
  nextPath: string;
};

export function AuthActionDialog({
  open,
  actionLabel,
  onClose,
  nextPath,
}: AuthActionDialogProps) {
  const t = useT();

  const loginHref = `/auth/login?next=${encodeURIComponent(nextPath)}`;
  const registerHref = `/auth/register?next=${encodeURIComponent(nextPath)}`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("auth_dialog.title")}
      description={t("auth_dialog.body", { action: actionLabel.toLowerCase() })}
      closeLabel={t("common.close")}
      footer={
        <>
          {/* Initial focus goes to the primary action, not the dismissive
              close X — useDialogFocus honours this attribute. */}
          <Link
            data-dialog-initial-focus
            href={loginHref}
            className={buttonClasses({ className: "flex-1" })}
          >
            {t("nav.sign_in")}
          </Link>
          <Link
            href={registerHref}
            className={buttonClasses({ variant: "secondary", className: "flex-1" })}
          >
            {t("auth_dialog.register")}
          </Link>
        </>
      }
    />
  );
}
