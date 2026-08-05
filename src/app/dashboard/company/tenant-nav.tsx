"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

// Split out of `layout.tsx` (which stays a server component) purely so the
// tenant tabs can read `usePathname()` and mark the current tab. Matching
// follows the same convention as `src/components/Navbar.tsx`: exact match, or
// prefix match for tabs that own sub-routes. `matchPath` is separate from
// `href` because every tab href carries a `?cid=` query string.
export function TenantNavLink({
  href,
  matchPath,
  exact = false,
  icon,
  children,
}: {
  href: string;
  matchPath: string;
  exact?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = exact
    ? pathname === matchPath
    : pathname === matchPath || pathname.startsWith(`${matchPath}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        // Tokens carry the theme, so the hand-picked `dark:` pairs (including a
        // per-surface ring offset) are gone.
        "inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm transition duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-safe:active:scale-[0.97]",
        active
          ? "bg-brand-soft font-semibold text-brand-on-soft"
          : "text-ink-secondary hover:bg-brand-soft hover:text-brand-on-soft"
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
