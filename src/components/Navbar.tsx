"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bell,
  Heart,
  LogOut,
  MapPin,
  Menu as MenuIcon,
  User,
  X,
} from "lucide-react";
import clsx from "clsx";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { Notification } from "@/lib/types";
import { formatDistanceToNow } from "date-fns";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { Menu, buttonClasses, usePresence } from "@/components/ui";
import { useT } from "@/i18n/client";

// The map is the home page, so its entry points at `/`; `/map` still resolves
// through a permanent redirect for older links.
//
// The register, open needs and the "find help" wizard used to be three entries
// answering three halves of one question. They are now views of a single
// register, and `/needs` and `/quick-start` redirect into the Donate page.
const navLinks = [
  { href: "/", labelKey: "nav.map" },
  { href: "/organisations", labelKey: "nav.organisations" },
  { href: "/doniraj", labelKey: "nav.donate" },
  { href: "/volunteer", labelKey: "nav.volunteer" },
  { href: "/o-nama", labelKey: "nav.about" },
] as const;

// An NGO account posts volunteer events; it doesn't sign up for them. The
// "Volunteer" tab answers a question only an individual account asks, so it
// is dropped from an NGO's own nav rather than shown and disabled.
function navLinksForRole(role: string | undefined) {
  if (role !== "ngo") return navLinks;
  return navLinks.filter((link) => link.href !== "/volunteer");
}

function isNavLinkActive(
  href: string,
  pathname: string,
  currentView: string | null
): boolean {
  const [hrefPath, hrefSearch = ""] = href.split("?");
  const hrefView = new URLSearchParams(hrefSearch).get("view");
  if (hrefView) return pathname === hrefPath && currentView === hrefView;
  if (hrefPath === "/organisations") {
    return (pathname === hrefPath || pathname.startsWith(`${hrefPath}/`)) && !currentView;
  }
  return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
}

const ICON_BUTTON =
  "relative inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:bg-ink/[0.08] hover:text-ink motion-safe:active:scale-[0.92] motion-safe:transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentView = searchParams.get("view");
  const active = isNavLinkActive(href, pathname, currentView);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium",
        "transition-[color,background-color,transform] duration-150 ease-out",
        "motion-safe:active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        active
          ? "bg-brand-soft text-brand"
          : "text-ink-secondary hover:bg-ink/[0.08] hover:text-ink"
      )}
    >
      {label}
    </Link>
  );
}

function NotificationPanel({
  id,
  open,
  notifications,
  onMarkRead,
  onMarkAllRead,
  onClose,
  triggerRef,
}: {
  id: string;
  open: boolean;
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    // The gutter wrapper gives the popover the page's horizontal inset while
    // still letting it scale out of its own right edge.
    <div className="pointer-events-none absolute inset-x-4 top-full sm:inset-x-6 lg:inset-x-10">
      <div className="pointer-events-auto relative">
        <Menu
          open={open}
          onClose={onClose}
          align="top-right"
          returnFocusRef={triggerRef}
          role="region"
          aria-label={t("notifications.title")}
          className="max-h-[70dvh] w-80 sm:w-96"
        >
          <div id={id}>
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <h3 className="text-sm font-semibold text-ink">
                {t("notifications.title")} {unreadCount > 0 ? `(${unreadCount})` : ""}
              </h3>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="rounded-full px-2 py-1 text-xs font-semibold text-brand transition-colors hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {t("notifications.mark_all_read")}
                </button>
              ) : null}
            </div>

            <div className="max-h-[60dvh] overflow-y-auto overscroll-contain">
              {notifications.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-ink-tertiary">
                  {t("notifications.empty")}
                </p>
              ) : (
                notifications.map((n) => {
                  const body = (
                    <>
                      <p className="text-sm font-semibold text-ink">{n.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-ink-secondary">
                        {n.body}
                      </p>
                      <p className="mt-1 text-xs text-ink-tertiary">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </p>
                    </>
                  );
                  return (
                    <div
                      key={n.id}
                      className={clsx(
                        "border-b border-border-subtle/60 transition-colors last:border-b-0",
                        n.is_read ? "bg-transparent" : "bg-brand-soft/50"
                      )}
                    >
                      {n.link ? (
                        <Link
                          href={n.link}
                          onClick={() => {
                            if (!n.is_read) onMarkRead(n.id);
                            onClose();
                          }}
                          className="block px-4 py-3 transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                        >
                          {body}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (!n.is_read) onMarkRead(n.id);
                          }}
                          className="block w-full px-4 py-3 text-left transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                        >
                          {body}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </Menu>
      </div>
    </div>
  );
}

const MENU_ITEM =
  "flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand";

/**
 * The account button: its own icon, separate from anything else in the bar.
 * The dropdown holds only the profile link and, last, sign out — always in
 * that order, so signing out is never the first thing the menu offers.
 */
function ProfileMenu({
  displayName,
  profileEmail,
  onLogout,
}: {
  displayName: string;
  profileEmail?: string;
  onLogout: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={displayName}
        title={profileEmail}
        aria-expanded={open}
        aria-haspopup="true"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-150 ease-out hover:bg-ink/[0.08] motion-safe:active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <User className="h-4 w-4" aria-hidden="true" />
      </button>

      <Menu
        open={open}
        onClose={() => setOpen(false)}
        align="top-right"
        returnFocusRef={triggerRef}
        role="region"
        aria-label={displayName}
        className="w-64"
      >
        <div className="py-2">
          <Link
            href="/dashboard"
            title={profileEmail}
            onClick={() => setOpen(false)}
            className={MENU_ITEM}
          >
            <User className="h-5 w-5 shrink-0 text-ink-tertiary" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{displayName}</span>
          </Link>
          <div className="my-2 h-px bg-border-subtle" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className={MENU_ITEM}
          >
            <LogOut className="h-5 w-5 text-ink-tertiary" aria-hidden="true" />
            {t("nav.sign_out")}
          </button>
        </div>
      </Menu>
    </div>
  );
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<SupaUser | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [meProfile, setMeProfile] = useState<{ name: string; email: string; role: string } | null>(
    null
  );
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentView = searchParams.get("view");
  const router = useRouter();
  const t = useT();
  const mobileNav = usePresence(mobileOpen);
  // Holds whichever bell opened the panel (there is a desktop and a mobile
  // one), so the popover can ignore clicks on it and hand focus back on Escape.
  const bellRef = useRef<HTMLElement | null>(null);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setUser(null);
      return;
    }

    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setMeProfile(null);
      return;
    }
    let cancelled = false;
    fetch("/api/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { profile?: { name: string; email: string; role: string } } | null) => {
        if (cancelled || !data?.profile) return;
        setMeProfile({
          name: data.profile.name,
          email: data.profile.email,
          role: data.profile.role,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !panelOpen) return;
    const controller = new AbortController();
    fetch("/api/notifications", {
      credentials: "include",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { notifications?: Notification[] } | null) => {
        if (data) setNotifications(data.notifications ?? []);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [user, panelOpen]);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mark_all_read: true }),
    }).catch(() => {});
  }, []);

  async function handleLogout() {
    if (!isSupabaseConfigured) {
      setUser(null);
      setNotifications([]);
      router.push("/");
      return;
    }

    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setNotifications([]);
    setPanelOpen(false);
    router.push("/");
    router.refresh();
  }

  const displayName =
    meProfile?.name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    t("nav.user_fallback");

  const profileEmail = meProfile?.email || user?.email || undefined;

  const notificationBadge =
    unreadCount > 0 ? (
      <span
        className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold tabular-nums text-white"
        aria-hidden="true"
      >
        {unreadCount > 99 ? "99+" : unreadCount}
      </span>
    ) : null;

  const notificationLabel =
    unreadCount > 0
      ? t("notifications.unread_count", { count: unreadCount })
      : t("notifications.title");

  return (
    <header
      data-ui-material
      className={clsx(
        "sticky top-0 z-[var(--z-chrome)] border-b border-transparent",
        // Glass, not a rule. Light mode uses a soft dark wash; dark mode
        // cannot — black-on-near-black is invisible — so a faint light lip
        // is what reads as the glass edge.
        "bg-chrome pt-2 shadow-raised backdrop-blur-xl backdrop-saturate-150",
        "dark:shadow-[0_1px_0_0_rgb(255_255_255/0.08),0_12px_24px_-8px_rgb(0_0_0/0.45)]"
      )}
    >
      <div className="relative flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full py-1 pl-0.5 pr-2.5 transition-colors duration-150 hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          onClick={() => setMobileOpen(false)}
        >
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand">
            <MapPin className="absolute h-4 w-4 opacity-70" strokeWidth={2} aria-hidden="true" />
            <Heart className="relative h-5 w-5 fill-brand text-brand" strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="text-xl font-semibold tracking-[-0.02em] text-brand">
            DajSrce
          </span>
        </Link>

        {/* Centred on the viewport, not between the logo and the actions, so
            the track stays on the midline regardless of how wide those are. */}
        <nav
          className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center rounded-full border border-border-subtle bg-surface-sunken p-1 lg:flex"
          aria-label={t("nav.main_navigation")}
        >
          {navLinksForRole(meProfile?.role).map(({ href, labelKey }) => (
            <NavLink key={href} href={href} label={t(labelKey)} />
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <LocaleSwitcher />
          <ThemeToggle />
          <div className="inline-flex items-center rounded-full border border-border-subtle bg-surface-raised p-1 shadow-raised">
            {user ? (
              <button
                type="button"
                onClick={(event) => {
                  bellRef.current = event.currentTarget;
                  setPanelOpen((o) => !o);
                }}
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-secondary transition-[background-color,transform] duration-150 hover:bg-ink/[0.08] hover:text-ink motion-safe:active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                aria-label={notificationLabel}
                aria-expanded={panelOpen}
                aria-controls="notifications-panel"
              >
                <Bell className="h-5 w-5" aria-hidden="true" />
                {notificationBadge}
              </button>
            ) : (
              // Signing in stays visible in the bar. The dropdown no longer
              // repeats it; the two share one pill so they read as one control.
              <Link
                href="/auth/login"
                className={buttonClasses({ size: "sm", className: "h-9 px-3.5" })}
              >
                {t("nav.sign_in")}
              </Link>
            )}
            {user ? (
              <ProfileMenu
                displayName={displayName}
                profileEmail={profileEmail}
                onLogout={handleLogout}
              />
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1 lg:hidden">
          <ThemeToggle />
          {user ? (
            <button
              type="button"
              onClick={(event) => {
                bellRef.current = event.currentTarget;
                setPanelOpen((o) => !o);
              }}
              className={ICON_BUTTON}
              aria-label={notificationLabel}
              aria-expanded={panelOpen}
              aria-controls="notifications-panel"
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {notificationBadge}
            </button>
          ) : null}
          <button
            type="button"
            className={ICON_BUTTON}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? t("nav.close_menu") : t("nav.open_menu")}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? (
              <X className="h-6 w-6" aria-hidden="true" />
            ) : (
              <MenuIcon className="h-6 w-6" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {user ? (
        <NotificationPanel
          id="notifications-panel"
          open={panelOpen}
          notifications={notifications}
          onMarkRead={markRead}
          onMarkAllRead={markAllRead}
          onClose={() => setPanelOpen(false)}
          triggerRef={bellRef}
        />
      ) : null}

      {mobileNav.present ? (
        <div
          id="mobile-nav"
          data-ui-motion
          data-state={mobileNav.state}
          onAnimationEnd={mobileNav.onAnimationEnd}
          className={clsx(
            "origin-top border-t border-border-subtle bg-surface-overlay px-4 py-4 shadow-overlay lg:hidden",
            "data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out"
          )}
        >
          <nav className="flex flex-col gap-1" aria-label={t("nav.mobile_navigation")}>
            {navLinksForRole(meProfile?.role).map(({ href, labelKey }) => {
              const active = isNavLinkActive(href, pathname, currentView);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "cursor-pointer rounded-control px-3 py-3 text-base font-medium transition-colors",
                    "motion-safe:active:scale-[0.98] motion-safe:transition-transform",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    active
                      ? "bg-brand-soft text-brand-on-soft"
                      : "text-ink hover:bg-ink/[0.08]"
                  )}
                  onClick={() => setMobileOpen(false)}
                >
                  {t(labelKey)}
                </Link>
              );
            })}

            <div className="my-2 h-px bg-border-subtle" />
            <div className="px-1 pb-2">
              <LocaleSwitcher />
            </div>

            {user ? (
              <>
                <Link
                  href="/dashboard"
                  title={profileEmail}
                  className={clsx(
                    "rounded-control px-3 py-3 text-base font-medium text-brand transition-colors hover:bg-brand-soft",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  )}
                  onClick={() => setMobileOpen(false)}
                >
                  {displayName}
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    handleLogout();
                  }}
                  className={clsx(
                    "rounded-control px-3 py-3 text-left text-base font-medium text-ink-secondary transition-colors hover:bg-surface-sunken",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  )}
                >
                  {t("nav.sign_out")}
                </button>
              </>
            ) : (
              <Link
                href="/auth/login"
                className={buttonClasses({ fullWidth: true, className: "mt-2" })}
                onClick={() => setMobileOpen(false)}
              >
                {t("nav.sign_in")}
              </Link>
            )}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
