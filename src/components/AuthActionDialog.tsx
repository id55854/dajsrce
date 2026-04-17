"use client";

import Link from "next/link";

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
  if (!open) return null;

  const loginHref = `/auth/login?next=${encodeURIComponent(nextPath)}`;
  const registerHref = `/auth/register?next=${encodeURIComponent(nextPath)}`;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Login required
        </h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          To {actionLabel.toLowerCase()}, please sign in or create an account.
          Browsing remains public.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href={loginHref}
            className="inline-flex flex-1 items-center justify-center rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600"
          >
            Sign in
          </Link>
          <Link
            href={registerHref}
            className="inline-flex flex-1 items-center justify-center rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Register
          </Link>
        </div>
      </div>
    </div>
  );
}
