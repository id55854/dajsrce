"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, Heart, X } from "lucide-react";
import clsx from "clsx";
import { Button } from "@/components/ui";
import { useT } from "@/i18n/client";
import { NGO_SIGNUP_HREF } from "@/lib/auth/onboarding";
import { fetchMe } from "@/lib/me-client";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { TourIllustration } from "./illustrations";
import { cardWidthFor, layoutTour, type Rect } from "./tour-layout";
import { buildTourSteps, isOnStepPath, type TourTrack, type TourViewer } from "./tour-steps";
import { markTourSettled, writeTourProgress, type TourProgress } from "./tour-storage";

/** How long a step waits for its control to appear before it is shown centred. */
const LOCATE_TIMEOUT_MS = 4000;
const LOCATE_INTERVAL_MS = 120;

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
}

function findTarget(names: readonly string[]): HTMLElement | null {
  for (const name of names) {
    for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
      if (isVisible(element)) return element;
    }
  }
  return null;
}

function sameRect(a: Rect | null, b: DOMRect): boolean {
  return (
    a !== null &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

const SPOT_RADIUS = 14;

function roundedRectPath({ left, top, width, height }: Rect, radius: number): string {
  const r = Math.min(radius, width / 2, height / 2);
  const right = left + width;
  const bottom = top + height;
  return (
    `M${left + r} ${top}H${right - r}A${r} ${r} 0 0 1 ${right} ${top + r}` +
    `V${bottom - r}A${r} ${r} 0 0 1 ${right - r} ${bottom}` +
    `H${left + r}A${r} ${r} 0 0 1 ${left} ${bottom - r}` +
    `V${top + r}A${r} ${r} 0 0 1 ${left + r} ${top}Z`
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Below the sticky navbar, with room for the spotlight's padding. */
const REVEAL_TOP = 88;

/**
 * Scrolls the control into view when it is not. Wide screens centre it, since
 * the card goes beside it. On a phone the card docks to the bottom edge, so
 * the control is brought up under the navbar instead, clear of the card.
 */
function revealTarget(element: HTMLElement, cardHeight: number) {
  const rect = element.getBoundingClientRect();
  const phone = window.innerWidth < 640;
  const bottomLimit = phone ? window.innerHeight - cardHeight - 32 : window.innerHeight - 16;
  if (rect.top >= REVEAL_TOP - 24 && rect.bottom <= bottomLimit) return;
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
  if (!phone) {
    element.scrollIntoView({ block: "center", inline: "nearest", behavior });
    return;
  }
  const previous = element.style.scrollMarginTop;
  element.style.scrollMarginTop = `${REVEAL_TOP}px`;
  element.scrollIntoView({ block: "start", inline: "nearest", behavior });
  element.style.scrollMarginTop = previous;
}

/** Signed in or not, and as what. Read once; the navbar keeps its own copy. */
function useTourViewer(): TourViewer | null {
  const [viewer, setViewer] = useState<TourViewer | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function resolve(): Promise<TourViewer> {
      if (!isSupabaseConfigured) return { signedIn: false };
      const { data } = await createClient().auth.getSession();
      if (!data.session) return { signedIn: false };
      const profile = await fetchMe();
      if (!profile) return { signedIn: false };
      return { signedIn: true, role: profile.role === "ngo" ? "ngo" : "individual" };
    }
    resolve()
      .catch((): TourViewer => ({ signedIn: false }))
      .then((value) => {
        if (!cancelled) setViewer(value);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return viewer;
}

export function Tour({ initial, onClose }: { initial: TourProgress | null; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const viewer = useTourViewer();
  const titleId = useId();
  const bodyId = useId();

  const [track, setTrack] = useState<TourTrack | null>(initial?.track ?? null);
  const [index, setIndex] = useState(initial?.index ?? 0);
  const origin = useRef(initial?.origin ?? `${pathname}${search ? `?${search}` : ""}`);

  const signedIn = viewer?.signedIn === true;
  const steps = useMemo(
    () => buildTourSteps(track ?? "individual", viewer ?? { signedIn: false }),
    [track, viewer]
  );
  const current = Math.min(index, steps.length - 1);
  const step = steps[current];
  const isIntro = current === 0;
  const isLast = current === steps.length - 1;
  const effectiveTrack: TourTrack = viewer?.signedIn ? viewer.role : (track ?? "individual");
  // An anonymous visitor answers "who are you?" on the first card; the tiles
  // are the way forward, so there is no separate Next button to press.
  const choosing = isIntro && !signedIn;
  const onPath = isOnStepPath(step, pathname, search);

  useEffect(() => {
    writeTourProgress({ track, index: current, origin: origin.current });
  }, [track, current]);

  // Open the page the step talks about. The target search below waits for it.
  useEffect(() => {
    if (!onPath && step.path) router.push(step.path, { scroll: false });
  }, [onPath, step, router]);

  const cardRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [locating, setLocating] = useState(true);
  const targetNames = useRef<readonly string[]>([]);

  useEffect(() => {
    setTarget(null);
    setLocating(true);
    targetNames.current = step.targets ?? [];
    if (!onPath) return;
    if (targetNames.current.length === 0) {
      setLocating(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = performance.now();
    const attempt = () => {
      if (cancelled) return;
      const element = findTarget(targetNames.current);
      if (element) {
        revealTarget(element, cardRef.current?.offsetHeight ?? 0);
        setTarget(element);
        setLocating(false);
        return;
      }
      if (performance.now() - started > LOCATE_TIMEOUT_MS) {
        setLocating(false);
        return;
      }
      timer = setTimeout(attempt, LOCATE_INTERVAL_MS);
    };
    attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [step, onPath]);

  // Follow the control while the page settles (the map loads, a list fills in,
  // a smooth scroll runs). One rect read per frame, and a render only when it
  // actually moved.
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    let frame = 0;
    const loop = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setViewport((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      if (target && !target.isConnected) {
        setTarget(findTarget(targetNames.current));
      } else if (target) {
        const next = target.getBoundingClientRect();
        setRect((prev) =>
          sameRect(prev, next) ? prev : { left: next.left, top: next.top, width: next.width, height: next.height }
        );
      } else {
        setRect((prev) => (prev === null ? prev : null));
      }
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [target]);

  const [cardHeight, setCardHeight] = useState(420);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new ResizeObserver(() => setCardHeight(card.offsetHeight));
    observer.observe(card);
    setCardHeight(card.offsetHeight);
    return () => observer.disconnect();
  }, []);

  const layout = layoutTour(viewport, target ? rect : null, {
    width: cardWidthFor(viewport),
    height: cardHeight,
  });
  const ready = onPath && !locating;

  // Everything behind the tour is out of reach while it runs: no clicks, no
  // tab stops, nothing for a screen reader to wander into. Declared before the
  // focus hook so it is lifted before focus is handed back to the page.
  useEffect(() => {
    const app = document.getElementById("app-content");
    app?.setAttribute("inert", "");
    return () => app?.removeAttribute("inert");
  }, []);

  const finish = useCallback(
    (destination?: string) => {
      markTourSettled();
      onClose();
      const here = `${window.location.pathname}${window.location.search}`;
      const goTo = destination ?? origin.current;
      if (goTo !== here) router.push(goTo);
    },
    [onClose, router]
  );
  const skip = useCallback(() => finish(), [finish]);

  useDialogFocus({ open: true, dialogRef: cardRef, onClose: skip });

  const next = useCallback(() => setIndex((value) => Math.min(value + 1, steps.length - 1)), [steps.length]);
  const back = useCallback(() => setIndex((value) => Math.max(value - 1, 0)), []);

  // Each step hands focus to its main button, so the keyboard carries on
  // where the eye does and a screen reader announces the new card.
  useEffect(() => {
    if (!ready) return;
    cardRef.current
      ?.querySelector<HTMLElement>("[data-dialog-initial-focus]")
      ?.focus({ preventScroll: true });
  }, [ready, current]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowRight" && !choosing && !isLast) {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft" && current > 0) {
        event.preventDefault();
        back();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [back, choosing, current, isLast, next]);

  function choose(choice: TourTrack) {
    setTrack(choice);
    setIndex(1);
  }

  const copyKey =
    isIntro && signedIn ? "intro_signed_in" : step.copy === "done" && signedIn ? "done_signed_in" : step.copy;
  const title = t(`tour.steps.${copyKey}_title`);
  const body = t(`tour.steps.${copyKey}_body`);
  const progress = t("tour.progress", { current: current + 1, total: steps.length });
  const primaryHref = signedIn ? "/dashboard" : effectiveTrack === "ngo" ? NGO_SIGNUP_HREF : "/auth/register";
  const primaryLabel = signedIn
    ? t("tour.cta_profile")
    : effectiveTrack === "ngo"
      ? t("tour.cta_register_ngo")
      : t("tour.cta_register");

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-modal)]" data-tour-overlay>
      {layout.spot && ready ? (
        <>
          {/* The dimmed page with a hole cut out for the control. A path with
              an even-odd hole, not a huge box-shadow: browsers are free to
              skip painting a shadow thousands of pixels wide. */}
          <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full">
            <path
              fill="var(--tour-scrim)"
              fillRule="evenodd"
              d={`M0 0H${viewport.width}V${viewport.height}H0Z ${roundedRectPath(layout.spot, SPOT_RADIUS)}`}
            />
          </svg>
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-[14px] border-2 border-white motion-safe:transition-[left,top,width,height] motion-safe:duration-300 motion-safe:ease-out"
            style={{
              left: layout.spot.left,
              top: layout.spot.top,
              width: layout.spot.width,
              height: layout.spot.height,
            }}
          >
            <span data-ui-motion className="absolute -inset-1.5 rounded-[18px] border-2 border-brand animate-tour-pulse" />
          </div>
        </>
      ) : (
        <div aria-hidden className="absolute inset-0 bg-[var(--tour-scrim)]" />
      )}

      {layout.arrow && ready ? (
        <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          <defs>
            <marker id="tour-arrow-head" viewBox="0 0 12 12" refX="7" refY="6" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
              <path d="M1 1 L11 6 L1 11 Z" fill="var(--brand)" stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
            </marker>
          </defs>
          <path
            key={step.id}
            data-ui-motion
            className="animate-tour-draw"
            d={`M${layout.arrow.from.x} ${layout.arrow.from.y} Q${layout.arrow.bend.x} ${layout.arrow.bend.y} ${layout.arrow.to.x} ${layout.arrow.to.y}`}
            fill="none"
            stroke="white"
            strokeWidth={3.5}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1"
            markerEnd="url(#tour-arrow-head)"
          />
        </svg>
      ) : null}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={clsx(
          "absolute flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-sheet bg-surface-raised shadow-modal ring-1 ring-border-subtle outline-none",
          "motion-safe:transition-[left,top,opacity] motion-safe:duration-300 motion-safe:ease-out",
          ready ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        style={{ left: layout.card.x, top: layout.card.y, width: layout.cardWidth }}
      >
        <div className="relative shrink-0 bg-[#F6F1EC]">
          <div className="mx-auto w-full max-w-[320px] max-sm:max-w-[230px] [@media(max-height:720px)]:max-w-[200px] [@media(max-height:560px)]:hidden">
            <TourIllustration scene={step.scene} />
          </div>
          <button
            type="button"
            onClick={skip}
            aria-label={t("tour.close")}
            className="absolute right-2 top-2 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white/80 text-[#3A3A3A] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">{progress}</p>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
              <div
                className="h-full rounded-full bg-brand motion-safe:transition-[width] motion-safe:duration-300"
                style={{ width: `${((current + 1) / steps.length) * 100}%` }}
              />
            </div>
          </div>
          <h2 id={titleId} className="mt-2 text-lg font-semibold leading-snug text-ink">
            {title}
          </h2>
          <p id={bodyId} className="mt-2 text-sm leading-6 text-ink-secondary">
            {body}
          </p>

          {choosing ? (
            <div className="mt-4 grid grid-cols-2 gap-3" role="group" aria-label={t("tour.choose_label")}>
              {(
                [
                  { value: "individual", icon: Heart, label: "tour.choose_individual", hint: "tour.choose_individual_hint" },
                  { value: "ngo", icon: Building2, label: "tour.choose_ngo", hint: "tour.choose_ngo_hint" },
                ] as const
              ).map(({ value, icon: Icon, label, hint }, position) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => choose(value)}
                  aria-pressed={track === value}
                  data-dialog-initial-focus={position === 0 ? true : undefined}
                  className={clsx(
                    "flex cursor-pointer flex-col items-center gap-1.5 rounded-card border-2 px-3 py-4 text-center",
                    "transition-[border-color,background-color,transform] duration-150 ease-out motion-safe:active:scale-[0.97]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                    track === value
                      ? "border-brand bg-brand-soft"
                      : "border-border-subtle bg-surface hover:border-brand hover:bg-brand-soft/40"
                  )}
                >
                  <Icon className="h-7 w-7 text-brand" strokeWidth={1.75} aria-hidden />
                  <span className="text-sm font-semibold text-ink">{t(label)}</span>
                  <span className="text-xs text-ink-secondary">{t(hint)}</span>
                </button>
              ))}
            </div>
          ) : null}

          {isLast ? (
            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
              <Button
                size="sm"
                className="sm:flex-1"
                data-dialog-initial-focus
                onClick={() => finish(primaryHref)}
              >
                {primaryLabel}
              </Button>
              <Button variant="secondary" size="sm" className="sm:flex-1" onClick={() => finish("/")}>
                {t("tour.cta_explore")}
              </Button>
            </div>
          ) : null}

          <div className="mt-5 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" className="-ml-2 px-2" onClick={skip}>
              {isLast ? t("tour.close") : t("tour.skip")}
            </Button>
            <div className="flex items-center gap-2">
              {current > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={back}
                  className="px-3"
                  icon={<ArrowLeft className="h-4 w-4" aria-hidden />}
                >
                  {t("tour.back")}
                </Button>
              ) : null}
              {!choosing && !isLast ? (
                <Button size="sm" onClick={next} data-dialog-initial-focus>
                  {isIntro ? t("tour.start") : t("tour.next")}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {ready ? `${progress}. ${title}` : ""}
      </p>
    </div>,
    document.body
  );
}
