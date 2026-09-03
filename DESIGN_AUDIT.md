# DajSrce Design Audit: toward a modern, fluid, Apple-grade interface

**Date:** 2026-08-05 · **Scope:** all of `src/` (68 TSX files + `globals.css`) plus the live site at dajsrce.hr · **Method:** four parallel deep audits (map discovery surface, public content pages, auth/dashboard surfaces, global motion & token inventory), evaluated against Apple's fluid-interface principles (WWDC *Designing Fluid Interfaces*, *Principles of Great Design*, *Details of UI Typography*).

**How to read this:** findings are grouped by system, each with file:line evidence and a fix direction. Section 11 turns them into a phased roadmap. Everything here is a design/UX finding, none of it touches the security or data invariants in `CLAUDE.md`, and every fix must preserve them (notably: no global Leaflet CSS, no remote Google fonts, ≤60 DOM rows, ≤200 map features, no global middleware).

---

## 0. Executive summary

The app is functionally deep and architecturally careful (viewport-bounded fetching with AbortController + sequence guards, ARIA on most controls, a dedicated accessibility menu, dark tiles for the map). But the *presentation layer has no system*: every visual and kinetic decision was made locally, per file, and it shows.

The quantitative snapshot:

| Metric | Current state |
|---|---|
| Design tokens (Tailwind `@theme`) | **0**: 100% raw defaults + 37 arbitrary-value utilities + 40 hex literals |
| Shared UI primitives (`Button`, `Input`, `Card`…) | **0**: `src/components/ui/` doesn't exist; ~10 input recipes, ~9 button recipes, 8+ badge recipes |
| Explicit motion durations / easings | 2 / 1: everything else is Tailwind's implicit 150 ms `ease` |
| Transitions that move something (transform) | 2 of 61: 70% of all "motion" is a color crossfade |
| Entrance animations / exit animations | 1 / **0**: 11 of 12 overlays pop in and all 12 pop out |
| `active:` press states | **0** across ~160 interactive elements |
| `focus-visible:` styling | 2 of ~160 elements |
| `prefers-reduced-motion` handling | 1 site (a `scrollIntoView`); all spinners, pulses, flyTos run unconditionally |
| `backdrop-blur` (material/translucency) | 1 (company dashboard bar); global navbar is opaque |
| `dvh`/`svh` / safe-area insets / `viewport-fit` | 0 / 0 / 0: five bottom-fixed elements, hardcoded `calc(100vh-64px)` |
| Distinct `<h1>` treatments | 12 (16px → 36px); responsive type steps: 1 in the whole app |
| Body text at `text-sm`/`text-xs` | 84% of all text utilities |
| z-index scales | 2 unreconciled: map chrome (`z-[400]`) outranks modals (`z-[120]`) |

The three highest-leverage moves, in order:

1. **Introduce a token layer + shared primitives** (§1, §2). Almost every consistency finding below collapses into "there was no component to reuse."
2. **Fix the mobile map shell** (§4). The core product surface gates search to one view and filters to another, lands new users on a dead-end "zoom in" hint, and scrolls/zooms against itself.
3. **Build a small motion system** (§3). Twelve overlays, one entrance animation, zero exits, zero press feedback; this is the single biggest gap between DajSrce and an "Apple-like" feel, and it's cheap to close once primitives exist.

---

## 1. Foundations: no design tokens (highest leverage)

**Finding.** `globals.css` contains zero `@theme` blocks. The only custom property is `--font-app-sans` (`src/app/globals.css:5-7`), declared outside `@theme` so it generates no utility. Consequences measured across `src/`:

- **Color:** all 11 shades of both `red-*` (597 uses) and `gray-*` (1,415 uses) are in play with no role separation, `red-500` and `red-600` both serve as primary button fill; `gray-100` and `gray-200` both serve as card border; `gray-800`/`gray-900`/`gray-950` all serve as dark surface. Tailwind's `#EF4444` is restated as a hex literal in 4 files (`src/app/company/[slug]/page.tsx:80`, `embed/route.ts:57`, `dashboard/company/new/page.tsx:40`, `settings-editor.tsx:45`).
- **Radius:** 6 values + `rounded-[14px]` one-offs; primary CTAs are `rounded-full` in half the app and `rounded-xl` in the other half, sometimes in the same card (`CompanyVerificationSection.tsx:269` vs `:312`).
- **Shadows:** 8 sizes + 13 ad-hoc tinted variants (`shadow-red-500/25`, `/20`, `/10`, `/5`…); elevation is not monotonic with layering (navbar `z-50` = `shadow-sm`, dropdown `z-[60]` = `shadow-xl`, modal `z-[120]` = also `shadow-xl`).
- **Z-index:** Tailwind scale (0–50) and an arbitrary scale (60–400) coexist; the map's search box/locate button (`z-[400]`, chosen to beat Leaflet's internal panes) outrank every modal in the app (`src/app/map/page.tsx:406,516,537,546` vs `AuthActionDialog.tsx:35`).
- **Scrim alphas:** `bg-black/40` (`PledgeButton.tsx:179`) vs `bg-black/45` (`AuthActionDialog.tsx:35`) vs fully transparent (`AccessibilityMenu.tsx:229`) for the same job. Ten distinct translucency steps overall, none tokenized.
- **Dead token:** `--font-dm-sans` is consumed by 6 headings (`QuickStartWizard.tsx:279,408,566`, `InstitutionDetailPanel.tsx:117,202,224`) but never defined anywhere, invalid at computed-value time, silently inherits Noto Sans. The DM Sans that *is* loaded lives only on login/register via Google Fonts (see §5/§10).

**Fix.** Author a single `@theme` block in `globals.css` and migrate by grep. Suggested shape (names matter more than exact values):

```css
@theme {
  /* semantic color, one anchor per role */
  --color-brand: oklch(0.637 0.237 25.3);        /* current red-500 */
  --color-brand-strong: /* hover, = red-600 */;
  --color-brand-soft: /* tint surfaces, = red-50 / red-950 pair via dark */;
  --color-success: /* emerald-600 */; --color-warning: /* amber-600 */;
  --color-danger: /* distinct from brand; see §6 */;
  --color-surface, --color-surface-raised, --color-border, --color-border-strong,
  --color-ink, --color-ink-secondary, --color-ink-tertiary;

  /* radius: 3 sizes + full */
  --radius-control: 0.75rem;   /* inputs, buttons that aren't pills */
  --radius-card: 1rem;
  --radius-sheet: 1.5rem;

  /* elevation: 3 steps, paired with layer */
  --shadow-raised, --shadow-overlay, --shadow-modal;

  /* motion */
  --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);
  --ease-spring: linear(…);    /* generated spring curve, see §3 */
  --duration-fast: 150ms; --duration-base: 250ms; --duration-slow: 350ms;
}
```

Adopt one z-index ladder (`base 0 / chrome 40 / dropdown 50 / sheet 60 / modal 70 / toast 80`) and demote the map overlays by containing Leaflet in an isolated stacking context (`isolation: isolate` on the map wrapper) so its internal 200–700 pane values never leak into app-level decisions.

---

## 2. Component system: everything is hand-rolled

**Finding.** There is no `src/components/ui/` and no `Button`, `Input`, `Card`, `Badge`, `Dialog`, or `Toast` component. Measured duplication:

- **Inputs, ~10 recipes.** `py-3/xl/ring-4` (`auth/login/page.tsx:134`), same minus `bg-white` (`register:254`), same minus all dark variants (`setup:200`), `py-2.5/ring-4` (`dashboard/institution/page.tsx:236`), `py-2/ring-2/shadow-sm` (`company/new:354`), `py-2/ring-2` no shadow (`settings-editor.tsx:380`), mono variant (`CompanyVerificationSection.tsx:263`), and several with **no focus treatment at all** (`CompanyExportsSection.tsx:122-146`, `CompanyReceiptsSection.tsx:103`, `team-manager.tsx:199`). The `/organisations` search strips the outline with no replacement (`organisations/page.tsx:207`, `outline-none`, nothing else).
- **Buttons, ~9 recipes** across 4 radii, 3 red anchors (`bg-red-500`, `bg-red-600`, `border-2 border-red-500`), 3 emerald variants doing "primary" work (`CompanyVerificationSection.tsx:312`, `verify-company/page.tsx:66`), 4 disabled opacities (40/50/60 + `cursor-not-allowed` sometimes), and 3 loading patterns (label swap, spinner+static label, spinner+label swap).
- **Badges, 8+ recipes** (px-2/2.5/3 × py-0.5/1/1.5 × font-medium/semibold × text-[11px]/xs/sm). The same pledge status renders amber on the map page (`YourPledgesSection.tsx:25-49` status map) and generic red on the dashboard (`individual-dashboard-client.tsx:157`).
- **Stat cards, 4 components** with different radius/border/shadow/label treatments (`company/page.tsx:203-234`, `admin/page.tsx:37-46`, `individual-dashboard-client.tsx:182-199`, `institution/page.tsx:168-173`).
- **Copy-pasted component:** the filter-chip row in `/needs` (`needs/page.tsx:182,199`) is byte-identical to `FilterBar.tsx:97,114`, and the two chip groups *on the same page* still disagree (`font-medium` vs `font-semibold`, `text-gray-600` vs `text-gray-700`).
- **Labels:** three association conventions (`htmlFor`+`id`, wrapping `<label>`, and bare unassociated `<label>`; the last on all 10 institution-form fields, `dashboard/institution/page.tsx:229-411`).
- **Dead components:** `EmergencyBanner.tsx` and `BadgeDisplay.tsx` are never imported anywhere. Both contain hardcoded English.

**Fix.** Build the primitive set once, in `src/components/ui/`, on the §1 tokens, then migrate surface by surface:

- `Button` (variant: primary/secondary/ghost/destructive; size; `loading` prop that standardizes spinner+label behavior and `disabled` opacity).
- `Input`/`Field` (label association, required marker, inline error slot with `aria-describedby`/`aria-invalid`, one focus ring recipe on `focus-visible`).
- `Card`, `Badge` (with the single status→color map), `Stat`.
- `Dialog`/`Sheet` (§3), `Menu` (dropdown), `Toast` (§7), `Skeleton`, `EmptyState` (icon + copy + action slot).

Pick **one** button silhouette: given 136 existing `rounded-full` uses and the friendly/charity brand, pills for buttons and `--radius-control` for inputs is the least-churn consistent rule. Delete `EmergencyBanner`/`BadgeDisplay` or wire them up intentionally.

---

## 3. Motion: there is no system, and nothing responds to touch

Apple's bar: instant response on pointer-down, continuous feedback, interruptible spring motion, symmetric enter/exit. Current state:

**Findings.**

- **Zero press feedback.** `active:` appears 0 times across ~160 interactive elements and 129 `onClick` handlers. On touch devices (where `hover:` never fires), tapping any control in the app produces no visual acknowledgement until the resulting state lands, for network actions, that's silence until a spinner appears.
- **Instant overlays.** 11 of 12 overlay surfaces mount/unmount in one frame with no transition: notification panel (`Navbar.tsx:402`), mobile nav (`Navbar.tsx:412`), company switcher (`CompanySwitcher.tsx:59`), pledge modal + scrim (`PledgeButton.tsx:177`), auth dialog + scrim (`AuthActionDialog.tsx:31`), map search dropdown, map detail panel, inline dashboard panels, toasts. The one entrance animation (`.a11y-panel-enter`, `globals.css:157-169`) has no exit, asymmetric, violating "disappear the way you came."
- **The one step transition is a hack.** QuickStartWizard crossfades the whole panel via a `requestAnimationFrame` opacity retrigger (`QuickStartWizard.tsx:135-139`), with no directional cue and a synchronous content swap while invisible.
- **Dead transitions.** `NeedCard.tsx:68` declares `transition-colors` and `VolunteerEventCard.tsx:17` declares `transition-shadow`, but neither has any hover state that changes those properties. `FilterBar.tsx:61` declares `transition-shadow` while the active state changes colors via inline style; so category chips snap while their sibling chips fade.
- **Theme toggle tears.** `ThemeToggle.tsx:22` flips `.dark` in one frame; the 43 elements with `transition-colors` fade over 150 ms while ~2,000 color utilities snap, visible tearing. The sun/moon icon is a hard DOM swap (`:33`).
- **No springs, no gestures, no interruptibility.** Zero pointer-event handlers, zero WAAPI, zero scroll-driven motion. The only physical interaction in the app is Leaflet's `maxBoundsViscosity` rubber-band (`Map.tsx:336`); which is good, and lonely.
- **Reduced motion is ignored** except one `scrollIntoView` (`volunteer/page.tsx:95`). The a11y menu's "stop animations" toggle can't touch Leaflet's JS `flyTo` and is never seeded from the OS preference.

**Fix; a three-layer motion system:**

1. **CSS layer (cheap, do first).** Add to every interactive element via the §2 primitives: `active:scale-[0.97]` with `transition-transform duration-100 ease-out` on buttons/cards/chips (feedback on press, not release); one hover recipe per component. Standardize durations on the §1 tokens; nothing needs to exceed 350 ms.
2. **Overlay layer.** Give `Dialog`/`Sheet`/`Menu`/`Toast` symmetric enter/exit. Menus/popovers: scale from `transform-origin` at the trigger (0.96→1 + fade, ~180 ms `--ease-out-quart`); dialogs: scale 0.97→1 + fade with a scrim fade; mobile pledge sheet: actually slide up (it's already `items-end` sheet-shaped, `PledgeButton.tsx:179`, but never slides). Since exit-on-unmount is the hard part in React, either adopt **Motion** (`motion` on npm, springs, `AnimatePresence`, ~small for this use) or keep pure CSS with a 2-state `data-state="open|closed"` pattern and `@starting-style`/transition-behavior (supported in current evergreen browsers). Springs: default critically damped (`bounce: 0, duration: 0.35`); reserve `bounce: 0.2` for the sheet, which a flick precedes.
3. **Preference layer.** Wrap all motion utilities in `motion-safe:`, add a global `@media (prefers-reduced-motion: reduce)` block that turns overlay transitions into opacity-only fades, seed the a11y "stop animations" default from `matchMedia("(prefers-reduced-motion: reduce)")`, and pass `{ animate: false }` to Leaflet `flyTo`/`setView` when reduced motion is on. Use `document.startViewTransition` for the theme toggle (one clean crossfade instead of tearing) with a reduced-motion fallback of no transition.

---

## 4. The map surface (core product): layout, reachability, and motion

This is the landing page (`/` redirects to `/map`) and the most-used surface. It has the most structural findings.

### 4.1 The shell fights the browser

- `h-[calc(100vh-64px)]` (`map/page.tsx:116,384`) hardcodes the navbar height and uses `100vh`: on iOS/Android the URL bar overlaps the bottom-anchored controls (`bottom-4` list pill `:546`, `bottom-10` locate `:516`) on first paint. **Fix:** `h-[calc(100dvh-4rem)]`, or better a `--nav-height` token; add `viewport-fit=cover` + `env(safe-area-inset-bottom)` padding (see §8).
- **The page is ~130px taller than the viewport** because the global `Footer` renders under the fixed-height map (`layout.tsx:53-57`). The document scrolls; scrolling over the map zooms it instead (unconditional `scrollWheelZoom`, `Map.tsx:334`); reaching the footer pushes the search field off-screen. **Fix:** give `/map` a route group or layout flag without the footer (a full-viewport app surface has no footer in any map product), and make the shell exactly `100dvh` minus nav.

### 4.2 Mobile gates functionality behind an exclusive three-way swap

`mobileView` (`map/page.tsx:162`) hard-swaps map ↔ list via `hidden` toggles; the detail panel then replaces the list entirely (`:599-656`). Measured consequences:

- **Search is only reachable in map view** (`:404-502` lives in the map column); **filters and the result count are only reachable in list view** (`:568-579` live in the aside). The user literally cannot filter while seeing the map or search while seeing the list.
- The locate button lives on the map but force-ejects you to list view on success (`:342`), while the 850 ms fly-to-user animation plays on a map being hidden in the same commit (`Map.tsx:176`).
- Marker taps open a Leaflet popup that is never seen on mobile, `onSelect` hides the map in the same commit (`page.tsx:359-362`).
- The two toggles for one swap are different shapes, positions, and colors (red pill on map `:543-550`; text bar atop list `:559-566`), and the pill overlaps Leaflet's attribution on ~375px viewports.
- `mobileView` isn't in the URL or storage, so shared `?institution=` links land on the map with the detail panel loaded but invisible.

**Fix, replace the swap with a draggable bottom sheet** (the standard Apple Maps pattern, and the single biggest "Apple-like" win available):

- Map always visible underneath; one sheet with three detents (peek ≈ 96px: search field + count; half: list; full: list or detail). Search and filters live in the sheet header at every detent; everything reachable from everywhere.
- Implement with Pointer Events + `setPointerCapture`, 1:1 tracking respecting grab offset, velocity projection to pick the target detent (`project(v) = (v/1000)·0.998/(1−0.998)`), spring settle carrying release velocity (`bounce 0.2, duration 0.3`), rubber-band past the top detent. Interruptible: grabbing mid-flight re-targets from the live transform. `prefers-reduced-motion`: sheet snaps between detents with a short fade.
- Desktop: keep the split but let the detail panel slide over the list (translate-in, list stays mounted underneath) instead of replacing it, restoring list scroll position and spatial continuity for free (currently `scrollTop` bleeds between list and panel, `:582`, and the clicked card is unmounted by its own click).

### 4.3 Interaction bugs (fix regardless of redesign)

- **flyTo feedback loop:** `Map.tsx:153-160` depends on `institutions`, which gets a new identity on every fetch (`page.tsx:246`), with a selection active, every pan/zoom that completes a fetch flies the map back to the selected marker (650 ms). The user cannot explore around a selection. **Fix:** fly only when `selectedId` *changes* (ref-compare), not on data refresh.
- **Selecting a list item re-scopes the search:** the selection flyTo changes the viewport, which triggers a refetch and replaces the result set behind the panel. Consider suppressing viewport-fetch during selection flights, or fetch-but-freeze the list while detail is open.
- **Back button doesn't undo anything:** all state (including selection) goes through `history.replaceState` (`page.tsx:217-223`). **Fix:** `pushState` for selection open/close at minimum, so Back closes the panel instead of leaving the app.
- **Default landing is a dead end:** initial zoom 7 vs cluster threshold 12 means the list column's first-load state is the blue "zoom in" hint (`page.tsx:627-631`); a nationwide platform greets every visitor with an empty panel. **Fix:** at cluster zoom, populate the panel usefully (nearest cities/regions with counts as tappable rows, or top urgent needs), and/or geolocate-on-consent earlier.
- **Stale data isn't marked:** warm refetches keep old rows/markers fully interactive with only a 12px pill as evidence (`:504-508`; which also overlaps Leaflet's zoom-out button at `left-4 top-16`). **Fix:** dim the list ~60% during `refreshing` (the `/organisations` page already does exactly this; `organisations/page.tsx:326`), move the pill, add `aria-busy`.
- **Search dropdown:** full combobox ARIA but no `aria-activedescendant` and no arrow-key navigation (`:424-499`); results are `institutions.slice(0, 8)`, unranked, unmemoized (`:325`). Clearing search doesn't clear a stale selection.
- **`useDeferredValue` + 280 ms timer + 160 ms viewport debounce** stack up; typing re-queries the entire map layer, repainting all markers per keystroke settled (`:211`).

### 4.4 Map visual language

- **Selected pin is indistinguishable**, `buildIcons()` keys only on category (`Map.tsx:101-108`); nothing on the map shows which institution the panel describes. **Fix:** selected state = scale bump + ring + z-index elevation on the divIcon.
- **Clusters and pins share no visual DNA:** blue/red circles (`#1d4ed8`/`#dc2626`, urgency legend nowhere) vs category-colored teardrops; cluster keys embed zoom (`'cluster:'||zoom||…'`) so every zoom step remounts every marker with no fade, and the zoom-12 threshold is a one-frame subject change. **Fix:** shared palette + count-in-pin-shaped cluster; fade/scale markers in on add (CSS animation on the divIcon class, currently `className: ""` so there's no styling hook, `Map.tsx:52`); crossfade the zoom-11→12 handoff.
- **Popups are redundant noise:** same click already opens the full panel; default Leaflet chrome (12px radius, its own font sizing) doesn't match the app; dark mode patches wrapper+tip but not the close button (`globals.css:19-25`); body text `text-gray-600` fights the dark wrapper (`Map.tsx:249,270`, ≈2.3:1 contrast). **Fix:** remove pin popups entirely (keep hidden-location circle explanation elsewhere); selection state on the pin + panel is enough.
- **Stock Leaflet zoom control:** monospace `+`/`−` glyphs, 0.65-alpha shadow, 26px targets; the only chrome outside the app's system. **Fix:** `zoomControl={false}` + custom control using the app's button primitive (also fixes the "updating" pill overlap).
- **Theme swap remounts the tile layer** with `key={dark ? "dark" : "light"}` (`Map.tsx:342`), hard cut with a flash. Crossfade two tile layers or accept but pre-warm. The dark basemap (`dark_all`) is also visually unrelated to light Voyager (label density, hue); consider CARTO `dark_matter`+Voyager pairing or a matched pair.
- **User-location dot** is static (`Map.tsx:84-99`); no pulse (add a `motion-safe` CSS pulse), no accuracy circle despite `enableHighAccuracy`; white border isn't dark-adjusted (pins and clusters are).
- **Truncation is nearly invisible:** up to 90 fetched institutions render as pins but not list rows, signalled only by a grey footnote (`page.tsx:650-654`). **Fix:** make it an actionable notice ("Showing 60 of N, zoom in or filter") near the count, not below row 60.

---

## 5. Typography: one size fits nothing

**Findings.**

- 84% of all text is 12–14px; `text-base` (16px) appears 12 times in the whole app. An `<h3>` is *smaller than body text* in most of the app (`text-sm font-semibold` ×10). Twelve distinct `<h1>` treatments range 16→36px; exactly one heading in the app has a responsive step and only 3 headings are tracked (`tracking-tight`).
- Leading is tuned 8 times across 556 text utilities; tracking is 29× `tracking-wide` on uppercase eyebrows and almost nothing else. No negative tracking on any 2xl+ heading (Apple: large text wants tighter tracking; body near 0).
- Two page-level font overrides: login/register load **DM Sans from Google Fonts** (`auth/login/page.tsx:10`, `register/page.tsx:11`); a remote-font exception to the repo's own rule ("no remote Google fonts", `CLAUDE.md`), with no `latin-ext`, so Croatian diacritics on those pages fall back mid-word. The register→setup flow swaps typeface mid-onboarding.
- `--font-dm-sans` referenced 6 times, defined 0 times (§1). The detail panel's institution name; the most display-like text in the app; silently renders in body Noto Sans (`InstitutionDetailPanel.tsx:117`).
- Noto Sans ships as 3 static cuts (400/600/700), fine, but no optical sizing; `font-bold`+`font-semibold`+`font-medium` carry all hierarchy.
- The a11y font-size scaler multiplies root font-size (`AccessibilityMenu.tsx:69`), but with 84% of text specified in `rem`-derived utilities *below* 16px, 150% scaling produces 18–21px body, workable, but layouts with fixed `w-80`/`h-28` assumptions (skeletons, panels) don't scale with it.

**Fix.**

- Define a type scale as tokens and semantic heading classes (or a `<PageHeader>` primitive): display 30/36 responsive `tracking-[-0.02em]`, title 24, section 18/20, body 16 (**raise default body from 14→16**), caption 13, overline 12 uppercase `tracking-wide`. Kill `text-[9px]`–`text-[12px]` arbitrary sizes (fold into caption).
- One `<h1>` recipe per page type; restore the `/organisations` treatment (`text-3xl sm:text-4xl font-bold tracking-tight`) as *the* standard; it's already the best one in the app.
- Drop DM Sans entirely (both the Google-Fonts load and the dead variable): one family, Noto Sans, with weight/size/leading doing hierarchy, or, if a display face is wanted, self-host it with `latin-ext` and define the variable globally.
- Load OpenDyslexic as a real self-hosted font or remove the a11y option that claims it (`globals.css:103-109` currently falls through to Comic Sans MS → generic sans).

---

## 6. Color & dark mode

**Findings.**

- **Semantics are unmapped.** Emerald = success *and* arbitrary CTA color (`QuickStartWizard.tsx:595` "View details"); blue = "today" *and* "delivered" *and* "Directions" (`InstitutionDetailPanel.tsx:245`; the loudest button on a red-branded surface is blue); warning splits between amber and orange-500 on adjacent surfaces; error red is indistinguishable from brand red (the error toast `bg-red-600`, `PledgeButton.tsx:327`, is the same fill as submit buttons); rose/pink/red all encode different meanings within one component pair (`InstitutionCard.tsx:116` pink vs `InstitutionDetailPanel.tsx:94` rose for the same "hidden location" concept).
- **Category colors bypass theming entirely.** `CATEGORY_CONFIG` stores light-mode hex pairs (`constants.ts:24-102`) applied via inline `style`, near-white chips on dark cards on every card, panel, chip, and pin (`InstitutionCard.tsx:83`, `FilterBar.tsx:66-75`, `InstitutionDetailPanel.tsx:109-112`). Two category hues are near-indistinguishable at pin size (`#14b8a6` vs `#0d9488`).
- **Light-only surfaces:** `auth/setup/page.tsx` (0 dark variants in the whole file, sits between two dark-complete pages in one flow), `QuickStartWizard.tsx` (light-only except one emerald block), `src/app/institution/[id]/page.tsx` (public SSR page, permanently light), `PrintConfirmationButton.tsx`, `BadgeDisplay.tsx` badge circles, plus ~25 scattered `text-gray-500`/`text-red-600` without dark pairs (catalogued in the agent reports; grep `text-gray-500(?!.*dark:)` per file).
- **Footer:** `text-gray-500` on `dark:bg-gray-900` ≈ 3.9:1, below AA for its `text-sm` copy (`Footer.tsx:11,22`); also the only `dark:bg-gray-900` page-level surface on a `gray-950` app, so it reads as a lighter slab.
- Gradients: 11 decorative `bg-gradient-to-b from-red-50/*` washes, three different stops for the same "warm page top" idea.

**Fix.**

- Map §1 semantic tokens: brand ≠ danger (shift danger toward a deeper/oranger red or reserve `red-600`+icon for errors and pure `brand` for actions); success = one emerald pair; warning = one amber pair; info = one blue pair. One status→badge map shared app-wide (extend `YourPledgesSection.tsx:25-49`'s `STATUS_STYLES` into the Badge primitive).
- Convert `CATEGORY_CONFIG` to CSS custom properties with light+dark values (`--cat-food`, `--cat-food-surface`, …), consumed by classes instead of inline `style`. Pins/clusters read the same vars (JS can `getComputedStyle` once per theme).
- Sweep the light-only surfaces; add `dark:` coverage to `setup`, wizard, institution SSR page as a single pass.
- Pick one dark surface ramp: page `gray-950`, card `gray-900`, raised `gray-800`, border `gray-800/700, then enforce by token.

---

## 7. Feedback & states: silence, spinners, and full reloads

**Findings.**

- **No toast system.** One local toast exists inside `PledgeButton` (`:321-334`, appears/disappears instantly). Everywhere else: success is silent (pledge acknowledge, mark-delivered, export/receipt/CSR generation, domain verify, all just refetch), or a persistent inline string styled identically to errors (`settings-editor.tsx:311` "Saved." in plain gray, never clears), or a banner that *replaces the form* and closes it on a 2 s timer (`institution/page.tsx:217-221`, content vanishes from under the user).
- **Failed downloads are completely silent** (`CompanyExportsSection.tsx:96-104` and siblings: `if (res.ok…)` with no else). Dead-click buttons when feature-gated (`:157`, enabled-looking button whose handler returns early).
- **No optimistic updates anywhere;** every mutation triggers `await load()` (blanking whole lists back to "Loading…", `institution-pledges-client.tsx:29-38`) or `router.refresh()`; one `window.location.reload()` (`billing-panel.tsx:47`).
- **No `loading.tsx`, `error.tsx`, or `not-found.tsx` anywhere under `src/app`.** Server dashboards freeze the old page during navigation; `notFound()` falls through to Next's unstyled default; `organisations/[id]:53` throws with no boundary. `Suspense` fallbacks that exist are empty.
- **Loading vocabulary:** skeleton (1 place), bare text (5+ variants, two different i18n keys for the same state on one page), full-page spinner, card spinner with hardcoded "Loading…" (`CompanyVerificationSection.tsx:190-197`), or nothing. Skeleton shapes don't match what they stand in for (`map/page.tsx:47-52`, `:601-604`), causing layout jumps.
- **Validation is on-submit only, one error slot per form,** no `aria-invalid`/`aria-describedby`, no `role="alert"` on most banners, three different banner styles + three different placements (§1c of the auth agent's findings). Password rule stated in the label but only enforced on submit (`register:51`). No password reset flow exists at all; no show-password toggle.
- **Native `confirm()`/`alert()`** for destructive actions (`team-manager.tsx:109`, `volunteers/page.tsx:79,97`).
- Buttons: three loading patterns and four disabled opacities (§2).

**Fix.**

- One `Toast` primitive (queue, enter/exit motion, `role="status"`/`aria-live`, auto-dismiss with hover-pause) used by *every* mutation; success gets a toast, failure gets a toast + inline detail where relevant.
- `loading.tsx` + `error.tsx` (+ styled `not-found.tsx`) for every route group; skeletons that mirror the real layout (build `Skeleton` variants per card type).
- Optimistic updates for the cheap, reversible ones (mark-read, acknowledge with note, mark-delivered), update in place, reconcile on response; keep full refetch for money/verification flows but *dim in place* instead of blanking (the `/organisations` pattern again).
- `Field`-level inline validation on blur + submit, error text under the field, `aria-invalid` + `aria-describedby`; one shared error-banner recipe for form-level failures.
- Replace `confirm()` with the Dialog primitive (destructive variant); replace `alert()` with toasts.
- Add a password reset flow (Supabase `resetPasswordForEmail` exists for exactly this) and a show-password toggle.

---

## 8. Responsiveness & platform integration

**Findings.**

- **No `viewport` export anywhere**, production serves the bare default meta (verified live on dajsrce.hr): no `viewport-fit=cover`, no `theme-color`, so iOS gets no safe-area integration and the browser chrome stays white in dark mode.
- **0 uses of `dvh`/`svh`; 12 `min-h-screen`;** five bottom-fixed elements (a11y FAB/panel, pledge toast, pledge sheet, map list pill) with no `env(safe-area-inset-bottom)`.
- **Touch targets below 44px throughout:** filter chips 32px (`FilterBar.tsx:61`), search clear-X 24px (`map/page.tsx:438`), detail close 36px, locale switcher segments ≈26×18px (`LocaleSwitcher.tsx:49`); the smallest controls in the app, in the primary nav.
- **No container queries.** The 40% desktop list panel is ~307px at `md`, but `InstitutionDetailPanel.tsx:133` keys `sm:grid-cols-2` off *viewport* width; a 2-column grid in a 280px box on every tablet.
- **No responsive tables strategy:** all tabular data is flex rows relying on `flex-wrap`, wrapping mid-metadata on mobile (`CompanyExportsSection.tsx:180` renders framework·period·version as one concatenated string).
- Six page-shell recipes and mismatched sibling grids (`/needs` `md:2 lg:3 gap-6` vs `/organisations` `md:2 xl:3 gap-4`); `/quick-start` header (`max-w-2xl`) misaligned with its own card (`max-w-lg`).
- `touch-action`, `select-none`, tap-highlight: all 0, relevant once gestures (§4.2) arrive.

**Fix.**

- Add the Next.js `viewport` export in `layout.tsx`: `{ width, initialScale: 1, viewportFit: "cover", themeColor: [{media: "(prefers-color-scheme: dark)", color: "#030712"}, {color: "#ffffff"}] }`; pad bottom-fixed elements with `pb-[env(safe-area-inset-bottom)]`.
- Replace `min-h-screen`→`min-h-dvh` app-wide; fix the map shell per §4.1.
- Enforce ≥44px targets in the primitives (min-height on Button/chip; generous hit areas via padding, not icon size).
- Use `@container` on the map aside and dashboard cards (Tailwind 4 supports container queries natively) instead of viewport breakpoints inside panels.
- One page-shell component (`max-w-*` + `px-4 sm:px-6 lg:px-8 py-8` + header slot) consumed by all content pages.

---

## 9. Accessibility (beyond the menu)

The dedicated menu is a genuine feature, but the everyday keyboard/AT experience has gaps the menu can't paper over:

- **`focus-visible` on 2 of ~160 elements;** three inputs strip outlines with no replacement (§2). **Fix in the primitives:** every control gets `focus-visible:ring-2 ring-brand ring-offset-2` (offset color themed; the map card's selection ring already shows the bug: white offset halo in dark mode, `InstitutionCard.tsx:77`).
- **Dialog semantics are partial:** `InstitutionDetailPanel` has no `role="dialog"`, no Escape, no focus move/restore (`page.tsx:599-656`); closing it drops focus to `<body>`. `CompanySwitcher` declares `role="listbox"` with no keyboard behavior at all, no Escape, and a broken option structure (`ul`/`li` between listbox and options). The a11y panel claims `aria-modal` but doesn't lock scroll. **Fix:** fold everything into the `Dialog`/`Sheet`/`Menu` primitives built on `useDialogFocus` (which is already correct) + real listbox/menu keyboard support.
- **The a11y settings flash on first paint**, applied in `useEffect` from localStorage with no pre-paint script, unlike the theme (`layout.tsx:45-49`). **Fix:** extend the inline script to apply the stored a11y classes too.
- **High-contrast mode is a `!important` attack** on Tailwind class-name substrings (`globals.css:53-101`); it will silently rot as classes change. Once §1 tokens exist, re-implement as a token override block (`.high-contrast { --color-surface: #000; … }`) plus honor `prefers-contrast: more` automatically.
- `prefers-reduced-transparency`: relevant once §3/§12 materials land, pair every `backdrop-blur` with a solid fallback.
- Icon `aria-hidden` is inconsistent (three conventions counted); bake `aria-hidden` into an `Icon` wrapper or the primitives.
- Live regions: keep the good ones (`organisations` count, map count); add them to list-content changes and toasts.

---

## 10. Wayfinding, i18n, and dead surface area

- **Metadata:** root title/description are English on an `hr` site and still say "Zagreb" on a nationwide platform (`layout.tsx:11-15`, verified live). `/needs`, `/volunteer`, `/hub`, `/quick-start` export no metadata at all. **Fix:** localized `generateMetadata` per page; nationwide copy.
- **`/hub` is an orphan** (zero inbound links, hardcoded English, h1 is the site name). Decide: wire it up as a real home/landing for logged-out users, or delete it.
- **QuickStartWizard is entirely untranslated** (~20 literals from "What can I give?" to geolocation errors) under a Croatian h1; `Recent support actions` card on the company dashboard is hardcoded English and links to a retired route (`company/page.tsx:99,177-197`); invite flow has hardcoded "Redirecting…"; `institution/[id]` not-found is hardcoded Croatian outside i18n (`institution/[id]/page.tsx:146-152`).
- **Nav labels ≠ page titles** ("Directory" → "Croatian Associations Register"; "Find NGOs" → "What can I give?", three framings of one task on one screen). Pick one name per destination and reuse it in nav, h1, and `<title>`.
- **Dead-end content:** needs/volunteer cards never link to their institution despite having the id (`NeedCard.tsx:17,76`); company campaigns/stories render as cards with no link (`company/[slug]:186-212`); `/company/[slug]`'s only escape is a link labeled "DajSrce" that goes to `/map` (`:119-124`). Every empty state lacks an action (add "clear filters", "zoom out", "browse needs" CTAs).
- **Dashboards:** NGO dashboard is a re-export of institution's page, so URL and title disagree (`dashboard/ngo/page.tsx:1`); company tenant nav has no active state (`dashboard/company/layout.tsx:81-88`; no `usePathname`/`aria-current`, unlike the main navbar); double header + double brand on company dashboard; hardcoded `0` metrics presented as data (`institution/page.tsx:172`, `individual-dashboard-client.tsx:111`); show a real query or an honest em-dash.
- The auth dialog initially focuses the close button (dismissive) instead of the primary action (`AuthActionDialog` sets no `data-dialog-initial-focus`; `PledgeButton` does it right at `:262`).

---

## 11. What "Apple-like" specifically adds (materials & chrome)

Once tokens and primitives exist, three signature moves:

1. **Translucent chrome.** Navbar: `bg-white/75 backdrop-blur-xl` (dark: `bg-gray-950/75`) with a scroll-edge fade instead of the constant `shadow-sm`; same treatment for the map's floating search field and the sheet header; these float over live map tiles and are currently fully opaque (`map/page.tsx:422,516`). Pair with `prefers-reduced-transparency` solid fallbacks. The company dashboard bar already does this (`dashboard/company/layout.tsx:26`); promote its recipe to the token layer.
2. **Depth model.** Scrims fade in; sheets push content back slightly (scale 0.98 + dim) for modal tasks; one shadow token per elevation step so a dropdown never out-shadows a modal.
3. **Restraint.** Kill the decorative gradient washes (or standardize one), drop redundant popups, one accent per screen; the red brand reads stronger when blue/emerald stop competing for primary actions (§6).

---

## 12. Prioritized roadmap

**Phase 0, bug-level fixes, no design dependency (hours each):**
1. Map flyTo feedback loop (`Map.tsx:153-160`) and selection-refetch re-scoping (§4.3).
2. `viewport` export: `viewport-fit=cover`, `theme-color`; `min-h-screen`→`min-h-dvh`; map shell `dvh` + footer removal on `/map` (§4.1, §8).
3. Localized, nationwide root metadata; per-page titles (§10).
4. Delete or wire dead code: `EmergencyBanner`, `BadgeDisplay`, `--font-dm-sans` references, DM Sans imports, retired `new-action` link (§2, §5, §10).
5. Dark-mode sweep of the four light-only surfaces (§6) + footer contrast.
6. Focus: `focus-visible` ring on nav/map/list controls; dialog initial focus; Escape on CompanySwitcher (§9).

**Phase 1, tokens + primitives (the multiplier):**
`@theme` block (§1) → `Button`, `Input/Field`, `Card`, `Badge`, `Stat`, `Skeleton`, `EmptyState`, `PageShell` (§2, §8) → migrate auth flow first (smallest, most divergent), then dashboards, then public pages. Add press states + focus rings + 44px targets in the primitives so coverage is automatic.

**Phase 2, motion system:**
Overlay primitives with symmetric enter/exit (`Dialog`, `Sheet`, `Menu`, `Toast`); theme-toggle View Transition; wizard directional step transition; `prefers-reduced-motion` layer + seed the a11y toggle from OS (§3). Toast system + `loading.tsx`/`error.tsx` + skeleton parity (§7).

**Phase 3, map surface redesign (the flagship):**
Mobile bottom sheet with detents + gesture physics; search/filters always reachable; detail as overlay not replacement; selected-pin state; cluster/pin visual continuity; custom zoom control; useful default-zoom panel content; pushState for selection (§4).

**Phase 4, polish:**
Translucent chrome + scroll-edge effects (§11); typography scale rollout with responsive display sizes (§5); container queries in panels; QuickStartWizard + remaining i18n completion; high-contrast reimplementation on tokens (§9).

---

## Appendix: verification checklist per phase

- `npm run check`, `npm audit`, `npm run build`, `git diff --check` (repo gate).
- Map performance contract intact: ≤200 features/response, ≤60 DOM rows, clusters <12, ETag caching, no global Leaflet CSS, no remote fonts (Phase 1 *removes* the existing DM Sans remote-font violation).
- Manual: iPhone-size viewport (URL-bar collapse, safe areas, sheet gestures), keyboard-only pass (tab order, Escape, arrow keys in menus), VoiceOver/NVDA pass on dialogs and toasts, `prefers-reduced-motion` + `prefers-color-scheme` matrix, 150% a11y font size, Croatian diacritics on every changed text surface.
