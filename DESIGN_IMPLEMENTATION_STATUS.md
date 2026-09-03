# Design remediation: implementation status

**Date:** 2026-08-05 · **Findings source:** `DESIGN_AUDIT.md` (the reasoning behind each item; this file records what shipped).

**Status: Phases 0–4 of the audit roadmap are implemented.**

**Gate:** `npm run typecheck` clean · `npm test` **112/112 passing (18 files)** · `npm run build` compiles, **56/56 pages generate** · `npm audit` 0 vulnerabilities · `git diff --check` clean on `src/`.

`npm run lint` reports **one warning, in a file this work did not touch**: `scripts/audit-dgu-address-match.mjs:143`, `registryById` assigned but never used. That script is untracked and belongs to the concurrent registry work, and the repo rule is to preserve untracked user files, so it was left alone. Because `lint` runs with `--max-warnings=0` it fails the gate until that line is removed or renamed `_registryById`. Everything else lints clean (verified by re-running ESLint with only that file ignored).

**Runtime smoke test** (dev server, every route re-requested against a cleared log): `/map` `/needs` `/volunteer` `/quick-start` `/hub` `/organisations` `/auth/login` `/auth/register` `/auth/setup` `/auth/forgot-password` `/auth/reset-password` `/demo/ngo-plans` `/demo/volunteer-showcase` → 200; `/nonexistent` → 404 (designed page); **zero server errors**. Verified in the rendered `/map` HTML: the bottom sheet and its drag handle, translucent `bg-chrome` layers, the combobox, two live regions, Croatian copy resolving (`Filtri`), and **no raw translation keys leaking**.

---

## The foundation

### Design tokens (`src/app/globals.css`)
The app had **zero** tokens; it now has a semantic layer. Values live as custom properties on `:root`/`.dark`, exposed to Tailwind via `@theme inline` so one utility flips with the theme.

- **Color:** `brand` (+`-strong`/`-soft`/`-on-soft`), `success`/`warning`/`danger`/`info` (each with `-soft`/`-on-soft`), `surface`/`-raised`/`-sunken`/`-overlay`, `border`/`-strong`, `ink`/`-secondary`/`-tertiary`/`-inverse`, `chrome`, `scrim`. **`danger` is deliberately a deeper red than `brand`** so an error never reads as a call to action, enforced by a test.
- **Radius** (3 steps + full), **elevation** (one shadow per layer of the z-ladder, so a dropdown can no longer out-shadow a modal), **layering** (a single ladder, `--z-chrome` 40 → `--z-toast` 80, replacing two unreconciled scales in which map chrome outranked every modal), **motion** (`--ease-spring` sampled critically-damped spring, `--ease-out-quart`, three durations, **ten paired enter/exit animation tokens**).
- **Category colour** now flows through `categoryVars()` + the `category-chip`/`-tint`/`-accent` classes, which mix the category hue against the surface/ink tokens; so the palette themes itself instead of painting light-mode tints onto dark cards.
- **User preferences honoured automatically** (previously one `prefers-reduced-motion` check in the entire codebase): `prefers-reduced-motion` (overlay motion degrades to a cross-fade rather than disappearing), `prefers-reduced-transparency`, `prefers-contrast`. `.high-contrast` now overrides **tokens** instead of only matching utility class-name substrings.

### Component primitives (`src/components/ui/`)
Did not exist. Now: `Button`+`buttonClasses`, `Field`/`Input`/`Textarea`/`Select`, `Card` (polymorphic `as`), `Badge`, `Stat`, `Skeleton`/`SkeletonText`, `EmptyState`, `PageShell`/`PageHeader`/`SectionHeader`, `Dialog`, `Menu`, `Sheet`, `ToastProvider`/`useToast`, `usePresence`, and `spring.ts`.

Baked in so coverage is automatic: a `focus-visible` ring on every control (was **2 of ~160** elements), `motion-safe:active:scale-*` press feedback (was **0**, taps were silent on touch), 44px minimum control height, and `Field` guaranteeing `htmlFor`/`id`, `aria-invalid` and an error wired through `aria-describedby`.

- **`usePresence`** defers unmount until a CSS exit animation finishes; this is what makes symmetric enter/exit possible with no animation dependency. It falls back to a timer because `animationend` never fires when the accessibility menu's "stop animations" is on.
- **`Sheet`** implements real gesture physics: 1:1 tracking with grab offset via `setPointerCapture`, progressive rubber-band past the top detent, momentum projection (`projectMomentum`, the exponential-decay model native scrolling uses, not the physics-textbook `v²/2a`) to choose the destination detent, release velocity handed to the spring so there is no seam between drag and animation, and mid-flight interruption that re-targets from the live transform. Its JS spring checks reduced-motion *and* `.stop-animations` itself, since CSS cannot reach a `requestAnimationFrame` loop.

### Regression guards
`src/lib/design-system-contracts.test.ts` (14 tests) locks in the token layer, the paired enter/exit animations, the preference queries, the press/focus/disabled states, `Field`'s ARIA wiring, the Sheet's gesture physics, and platform hygiene, including **no `100vh`/`min-h-screen`** and **no remote webfonts** anywhere in `src/`.

---

## What changed, by surface

**Global chrome.** Navbar is now a translucent material content scrolls under; the notification panel and mobile nav animate in *and out* and dismiss on Escape; the theme flip runs through `document.startViewTransition` (replacing visible tearing between the ~43 elements that transitioned and the ~2,000 utilities that did not); the locale switcher has a sliding thumb and a pending state; the footer passes AA contrast and no longer renders on `/map`. The accessibility panel gained a symmetric exit, a real dimming scrim, and 40px stepper targets; its settings now apply **pre-paint** instead of flashing their defaults.

**Map (`/map`), rebuilt.** The mobile three-way swap is gone: the map stays mounted and interactive under one bottom sheet with three detents, whose header carries search, filters and the live count, so **all three are reachable at every detent** (previously search worked only in map view and filters only in list view). On desktop the detail slides over the list instead of replacing it, with real dialog semantics and focus restore. Clusters and pins now share one silhouette, palette and typeface, fade in on add, and no longer remount on a theme flip; the unexplained blue/red urgency hue swap became a badge with a legend. Leaflet's stock zoom control was replaced with a 44px themed one. Redundant pin popups removed. Earlier in the effort: the flyTo feedback loop (which flew the map back to the selection after *every* pan that completed a refetch), Back closing the detail panel, `dvh` sizing, an actually-distinguishable selected pin, and stale-data dimming.

**Auth.** Migrated to the primitives, **fully translated** (new `auth` namespace, was ~100% hardcoded English), and given the **password-reset flow that did not exist** (`resetPasswordForEmail` was never called anywhere), request and update pages that never leak whether an account exists. Errors are stored as translation keys so a mid-session locale switch re-renders them, and Supabase error codes are mapped to keys so raw server strings no longer reach the browser. Remote Google-Fonts DM Sans removed (it violated the project's own rule and lacked Croatian coverage).

**Public content.** All nine surfaces on one `PageShell`/`PageHeader`; ~5 button recipes, 8+ badge recipes, 3 card recipes and 4 input recipes collapsed into the primitives; the duplicated filter-chip markup consolidated into one exported `FilterChip` whose `aria-pressed` is a required prop that drives the visual state, so a chip cannot look active without announcing it. Need and volunteer cards now link to their institution (they had the id and rendered a dead `<span>`). `PledgeButton` became a real `Dialog` that slides as a sheet on mobile. `/needs` dims stale results in place instead of re-skeletoning the grid on every chip click.

**Dashboards.** Every mutation outcome now reports through `useToast`, including **six download paths that were previously silent on failure** and a domain-verify whose response was discarded so "not visible yet" looked like success. Cheap reversible mutations are optimistic and reconcile from the response; the rest dim in place. `window.confirm`/`alert` replaced with `Dialog`/toasts. Four divergent stat cards became one `Stat`; the concatenated `framework·period·version` string became labelled, aligned cells. Route boundaries (`loading.tsx`/`error.tsx`) added across the dashboard segments, plus app-wide `not-found.tsx` and `error.tsx`, there were **none anywhere** before.

---

## Carried forward

**Untranslated surfaces (~50 keys).** `src/app/dashboard/institution/**` (~30), `dashboard/admin`, `verify-company`'s confirm prompt and `company/confirmations` (~22 total) remain English. They were English before this work; nothing new was added to the debt, and every string is now in one place per file.

**`/hub` still has zero inbound links.** The page is correct and localised, but whether to surface it in the navbar or delete the route is a product decision.

**Not attempted.** `/company/[slug]`'s campaign cards still have no link target because no public campaign route exists. The `Sheet`'s mobile filter row opens as a modal panel rather than inline chips; the grab area's `touch-action: none` makes a nested horizontal scroller unreachable in Chromium, and 25 chips do not fit a peek header.

**Two cosmetic notes.** `organisations.retry` and `errors.retry` are duplicate strings. A handful of `Field` labels still use an inline `locale === "hr" ? … : …` ternary rather than a key.

---

## ⚠️ Out-of-scope change that appeared during this work: needs your review

A registry-on-the-map feature landed in the tree alongside the design work and is **not** part of this remediation:

- **`supabase/migrations/20260805160000_active_registry_map.sql`** (541 lines), new city/county centroid tables and derived `map_lat`/`map_lng`/`map_precision` for registry rows.
- **`MAP_API_VERSION` bumped 1 → 2**, plus `entityType`, `registryId` and `locationPrecision` added to the public map DTO, a new `association` institution category, and matching changes in `src/app/api/v1/map/institutions/route.ts`.

I did not author it and did not revert it. What I verified: it typechecks, its tests pass, its security-definer functions put `pg_catalog` first, and registry rows get **city/county centroids rather than exact addresses**, so the hidden-coordinate invariant holds.

What still needs a decision from you:
1. **`CLAUDE.md`'s migration list stops at #16** (`20260805010000_active_registry_scope.sql`). This migration is #17 and must be added; the repo requires the list and the application to be staged together.
2. A public map API version bump is a cache/contract change; confirm the deploy is staged per the runbook in `TECHNICAL_IMPLEMENTATION.md`.
3. Confirm the new `association` category and registry pins are intended to be publicly visible now, given the invariant that "registry classification is not organizational confirmation".
