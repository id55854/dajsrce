"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  ChevronRight,
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
import {
  A11yIcon,
  AccessibilityMenu,
  AccessibilityPanel,
} from "@/components/AccessibilityMenu";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { CompanySwitcher, type CompanySwitcherItem } from "@/components/CompanySwitcher";
import { Menu, buttonClasses, usePresence } from "@/components/ui";
import { useT } from "@/i18n/client";

// The map is the home page, so its entry points at `/`; `/map` still resolves
// through a permanent redirect for older links.
//
// The register, open needs and the "find help" wizard used to be three entries
// answering three halves of one question. They are now views of a single
// Associations page, and `/needs` and `/quick-start` redirect into it.
const navLinks = [
  { href: "/", labelKey: "nav.map" },
  { href: "/organisations", labelKey: "nav.organisations" },
  { href: "/volunteer", labelKey: "nav.volunteer" },
  { href: "/offers", labelKey: "nav.offers" },
  { href: "/o-nama", labelKey: "nav.about" },
] as const;

const ICON_BUTTON =
  "relative inline-flex h-10 w-10 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink motion-safe:active:scale-[0.92] motion-safe:transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "relative py-1 text-sm font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        active ? "text-brand" : "text-ink-secondary hover:text-ink"
      )}
    >
      {label}
      {/* An underline drawn as a positioned rule instead of text-decoration, so
          it sits clear of descenders and can animate independently. */}
      <span
        aria-hidden="true"
        className={clsx(
          "absolute -bottom-0.5 left-0 h-0.5 rounded-full bg-brand transition-[width] duration-250 ease-out",
          active ? "w-full" : "w-0"
        )}
      />
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
 * The combined navbar dropdown (the Airbnb-style round menu button): one place
 * for accessibility settings and the account actions. "Pristupačnost" swaps the
 * dropdown's content to the settings panel in place; the back chevron returns
 * to the item list.
 */
function NavMenu({
  user,
  displayName,
  profileEmail,
  onLogout,
}: {
  user: SupaUser | null;
  displayName: string;
  profileEmail?: string;
  onLogout: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "a11y">("main");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setView("main");
  }, []);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setView("main");
          setOpen((o) => !o);
        }}
        aria-label={t("nav.open_menu")}
        aria-expanded={open}
        aria-haspopup="true"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle/60 bg-surface-raised text-ink shadow-raised transition-[box-shadow,transform] duration-150 ease-out hover:shadow-overlay motion-safe:active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <MenuIcon className="h-4 w-4" aria-hidden="true" />
      </button>

      <Menu
        open={open}
        onClose={close}
        align="top-right"
        returnFocusRef={triggerRef}
        role="region"
        aria-label={t("nav.open_menu")}
        className={view === "a11y" ? "w-80 max-w-[calc(100vw-2rem)]" : "w-64"}
      >
        {view === "a11y" ? (
          <AccessibilityPanel onBack={() => setView("main")} />
        ) : (
          <div className="py-2">
            <button type="button" onClick={() => setView("a11y")} className={MENU_ITEM}>
              <A11yIcon className="h-5 w-5 text-ink-tertiary" aria-hidden="true" />
              <span className="flex-1">{t("a11y.title")}</span>
              <ChevronRight className="h-4 w-4 text-ink-tertiary" aria-hidden="true" />
            </button>

            <div className="my-2 h-px bg-border-subtle" />

            {user ? (
              <>
                <Link
                  href="/dashboard"
                  title={profileEmail}
                  onClick={close}
                  className={MENU_ITEM}
                >
                  <User className="h-5 w-5 shrink-0 text-ink-tertiary" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{displayName}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    onLogout();
                  }}
                  className={MENU_ITEM}
                >
                  <LogOut className="h-5 w-5 text-ink-tertiary" aria-hidden="true" />
                  {t("nav.sign_out")}
                </button>
              </>
            ) : (
              <Link href="/auth/login" onClick={close} className={MENU_ITEM}>
                <User className="h-5 w-5 text-ink-tertiary" aria-hidden="true" />
                {t("nav.sign_in")}
              </Link>
            )}
          </div>
        )}
      </Menu>
    </div>
  );
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<SupaUser | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [companies, setCompanies] = useState<CompanySwitcherItem[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [meProfile, setMeProfile] = useState<{ name: string; email: string } | null>(null);
  const pathname = usePathname();
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
      .then((data: { profile?: { name: string; email: string } } | null) => {
        if (cancelled || !data?.profile) return;
        setMeProfile({ name: data.profile.name, email: data.profile.email });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setCompanies([]);
      setActiveCompanyId(null);
      return;
    }
    // Fetch company memberships once per session; the switcher only
    // renders when the user belongs to at least two companies.
    fetch("/api/companies", { credentials: "include" })
      .then((r) => r.json())
      .then((data: { companies?: Array<{ id: string; slug: string; display_name: string | null; legal_name: string; logo_url: string | null; member_role: CompanySwitcherItem["role"] }> }) => {
        const list = (data.companies ?? []).map((c) => ({
          id: c.id,
          slug: c.slug,
          display_name: c.display_name,
          legal_name: c.legal_name,
          logo_url: c.logo_url,
          role: c.member_role,
        }));
        setCompanies(list);
        if (list.length > 0) {
          const stored = document.cookie
            .split("; ")
            .find((c) => c.startsWith("active_company="))
            ?.split("=")[1];
          setActiveCompanyId(stored ?? list[0]!.id);
        }
      })
      .catch(() => {});
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
        "sticky top-0 z-[var(--z-chrome)] border-b border-border-subtle",
        // A translucent layer that content scrolls under, rather than an opaque
        // strip that permanently consumes the top of the viewport.
        "bg-chrome backdrop-blur-xl backdrop-saturate-150"
      )}
    >
      {/* Full-bleed bar: the logo anchors the far left and the actions the far
          right, instead of everything gathering in a centered max-w column. */}
      <div className="relative flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 rounded-control py-1 pr-2 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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

        {/* Centred on the screen, not between its siblings, so the middle link
            sits on the viewport's midline regardless of how wide the logo and
            the action group are. */}
        <nav
          className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-8 md:flex"
          aria-label={t("nav.main_navigation")}
        >
          {navLinks.map(({ href, labelKey }) => (
            <NavLink key={href} href={href} label={t(labelKey)} />
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <LocaleSwitcher />
          <ThemeToggle />
          {user && companies.length > 1 ? (
            <CompanySwitcher items={companies} activeId={activeCompanyId} />
          ) : null}
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
          ) : (
            // Signing in is the primary action for a visitor who has not, so it
            // stays in the bar. Folding it into the dropdown put the one thing
            // an anonymous visitor might want two clicks away, behind a control
            // that gives no hint it is there. The dropdown still carries it, so
            // the two do not compete.
            <Link href="/auth/login" className={buttonClasses({ size: "sm" })}>
              {t("nav.sign_in")}
            </Link>
          )}
          <NavMenu
            user={user}
            displayName={displayName}
            profileEmail={profileEmail}
            onLogout={handleLogout}
          />
        </div>

        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <AccessibilityMenu />
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
            "origin-top border-t border-border-subtle bg-surface-overlay px-4 py-4 shadow-overlay md:hidden",
            "data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out"
          )}
        >
          <nav className="flex flex-col gap-1" aria-label={t("nav.mobile_navigation")}>
            {navLinks.map(({ href, labelKey }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "rounded-control px-3 py-3 text-base font-medium transition-colors",
                    "motion-safe:active:scale-[0.98] motion-safe:transition-transform",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    active
                      ? "bg-brand-soft text-brand-on-soft"
                      : "text-ink hover:bg-surface-sunken"
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
