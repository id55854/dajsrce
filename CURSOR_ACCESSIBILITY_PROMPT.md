# DajSrce Accessibility Menu — Cursor Implementation Prompt

Copy everything below this line and paste it into Cursor as a single prompt.

---

## Task: Implement an Accessibility Menu widget for DajSrce

Create a floating accessibility menu positioned in the **bottom-left corner** of the screen. It should have an accessibility icon button that opens a panel with various WCAG 2.1 AA adjustments. All preferences must persist via `localStorage`.

---

### Overview of features to implement:

| # | Feature | What it does |
|---|---------|-------------|
| 1 | **Font Size Adjustment** | Three buttons: decrease (A-), reset (A), increase (A+). Adjusts base font size from 90% to 150% in 10% steps. |
| 2 | **High Contrast Mode** | Toggles a `.high-contrast` class on `<html>`. Inverts to dark bg (#000) with bright text (#FFF), yellow links (#FFD700), forced borders on cards. |
| 3 | **Dyslexia-Friendly Font** | Loads OpenDyslexic from Google Fonts CDN and overrides `--font-dm-sans` with `"OpenDyslexic", sans-serif`. |
| 4 | **Highlight Links** | Adds `.highlight-links` class to `<html>`. All `<a>` tags get underline + yellow background + outline on focus/hover. |
| 5 | **Increase Spacing** | Toggles `.increase-spacing` class. Sets `letter-spacing: 0.12em`, `word-spacing: 0.16em`, `line-height: 1.8` globally. |
| 6 | **Grayscale Mode** | Toggles `.grayscale-mode` class on `<html>`. Applies `filter: grayscale(100%)` to the `<body>`. |
| 7 | **Big Cursor** | Toggles `.big-cursor` class on `<html>`. Sets `cursor: url(...) auto` with a 48x48 pointer SVG data URI, and `* { cursor: inherit }`. |
| 8 | **Stop Animations** | Toggles `.stop-animations` class. Sets `*, *::before, *::after { animation: none !important; transition: none !important; }`. |
| 9 | **Reset All** | Single button that clears all accessibility settings back to defaults. |

---

### FILE 1: `src/components/AccessibilityMenu.tsx` (NEW FILE)

Create a `"use client"` React component. Here is the detailed spec:

#### Imports
```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { Accessibility, X, RotateCcw, Type, Contrast, Eye, MousePointer2, Space, Pause } from "lucide-react";
```

#### State & localStorage
- Store all settings in a single object: `{ fontSize: 100, highContrast: false, dyslexiaFont: false, highlightLinks: false, increaseSpacing: false, grayscale: false, bigCursor: false, stopAnimations: false }`
- Key in localStorage: `"dajsrce-a11y"`
- On mount, read from localStorage and apply all classes/styles
- On every state change, persist to localStorage and apply/remove classes on `document.documentElement`

#### Toggle button (the icon)
- Fixed position: `bottom-4 left-4` (Tailwind), `z-50`
- Round button, 56x56px, red-500 bg (#ef4444), white icon
- Uses `<Accessibility />` icon from lucide-react (this is the universal accessibility ♿ symbol)
- `aria-label="Open accessibility menu"`
- `aria-expanded={isOpen}`
- On hover: slight scale-up (`hover:scale-110 transition-transform`)
- Box shadow for visibility: `shadow-lg`

#### Menu panel
- Opens above the toggle button, anchored bottom-left
- `fixed bottom-20 left-4`, max-width 320px, `z-50`
- Rounded-2xl, white bg (dark: gray-900), border, shadow-xl
- Has a header row: "Accessibility" title + close (X) button
- Scrollable content area with `max-h-[70vh] overflow-y-auto`
- Each feature is a row with: icon, label, and toggle switch (or +/-/reset buttons for font size)
- Close button and Escape key both close the panel
- `role="dialog"`, `aria-label="Accessibility settings"`, `aria-modal="true"`
- Focus trap: when open, Tab cycles within the panel. On close, focus returns to the toggle button.

#### Feature implementation details

**Font Size (special — not a toggle):**
- Row shows: `Type` icon, "Text Size" label, then three small buttons: `A-` | `A` (reset) | `A+`
- Applies via: `document.documentElement.style.fontSize = \`${fontSize}%\``
- Min 90%, max 150%, step 10%
- The `A` reset button sets it back to 100%

**All other features (toggle switches):**
- Each row: icon on left, label, toggle switch on right
- Toggle switch: a styled `<button role="switch" aria-checked={value}>` with sliding dot (Tailwind: `w-11 h-6 rounded-full` with inner `w-5 h-5` circle)
- Active state: red-500 bg. Inactive: gray-300.

**Reset All button:**
- Full-width button at the bottom of the panel
- `RotateCcw` icon + "Reset All Settings" label
- Clears localStorage key, removes all classes from `<html>`, resets font size to 100%
- Gray outline style, hover turns red

#### Animation
- Panel entrance: fade-in + slide-up (use Tailwind `animate-` or inline CSS transition)
- Keep it simple — a CSS class toggle is fine

#### Click outside to close
- Add a mousedown listener on document; if click target is outside the panel and outside the toggle button, close the menu.

#### Full component structure (pseudocode):
```
<>
  {isOpen && <div className="fixed inset-0 z-40" onClick={close} />}  // backdrop

  {isOpen && (
    <div role="dialog" aria-label="Accessibility settings" className="fixed bottom-20 left-4 z-50 w-80 ...">
      <div className="header">
        <Accessibility /> <span>Accessibility</span>
        <button onClick={close}><X /></button>
      </div>
      <div className="overflow-y-auto max-h-[70vh] p-4 space-y-3">
        {/* Font size row */}
        {/* High contrast toggle */}
        {/* Dyslexia font toggle */}
        {/* Highlight links toggle */}
        {/* Increase spacing toggle */}
        {/* Grayscale toggle */}
        {/* Big cursor toggle */}
        {/* Stop animations toggle */}
      </div>
      <div className="p-4 border-t">
        <button onClick={resetAll}>Reset All Settings</button>
      </div>
    </div>
  )}

  <button
    onClick={toggle}
    className="fixed bottom-4 left-4 z-50 h-14 w-14 rounded-full bg-red-500 text-white shadow-lg ..."
    aria-label="Open accessibility menu"
    aria-expanded={isOpen}
  >
    <Accessibility className="h-6 w-6" />
  </button>
</>
```

---

### FILE 2: `src/app/globals.css` (MODIFY)

Add these CSS rules **at the end** of the existing `globals.css` file. Do NOT remove any existing CSS:

```css
/* ===== ACCESSIBILITY OVERRIDES ===== */

/* High Contrast Mode */
.high-contrast body {
  background-color: #000 !important;
  color: #fff !important;
}
.high-contrast .bg-white,
.high-contrast .bg-gray-50,
.high-contrast .bg-red-50,
.high-contrast .bg-red-50\/60,
.high-contrast [class*="bg-white"],
.high-contrast [class*="bg-gray"] {
  background-color: #000 !important;
  color: #fff !important;
  border-color: #fff !important;
}
.high-contrast a {
  color: #FFD700 !important;
}
.high-contrast button {
  border: 2px solid #fff !important;
}
.high-contrast .text-gray-600,
.high-contrast .text-gray-500,
.high-contrast .text-gray-400,
.high-contrast .text-gray-700,
.high-contrast [class*="text-gray"] {
  color: #e5e5e5 !important;
}
.high-contrast .text-red-500,
.high-contrast .text-red-600,
.high-contrast [class*="text-red"] {
  color: #ff6b6b !important;
}
.high-contrast .border-gray-100,
.high-contrast .border-gray-200,
.high-contrast .border-red-100,
.high-contrast [class*="border-gray"],
.high-contrast [class*="border-red"] {
  border-color: #555 !important;
}
.high-contrast input,
.high-contrast textarea,
.high-contrast select {
  background-color: #111 !important;
  color: #fff !important;
  border-color: #666 !important;
}
.high-contrast .leaflet-container {
  filter: contrast(1.3) brightness(0.9);
}

/* Dyslexia-Friendly Font */
.dyslexia-font body,
.dyslexia-font input,
.dyslexia-font textarea,
.dyslexia-font select,
.dyslexia-font button {
  font-family: "OpenDyslexic", "Comic Sans MS", sans-serif !important;
}

/* Highlight Links */
.highlight-links a {
  text-decoration: underline !important;
  text-decoration-thickness: 2px !important;
  text-underline-offset: 3px !important;
  background-color: rgba(255, 215, 0, 0.2) !important;
  padding: 0 2px !important;
  border-radius: 2px !important;
}
.highlight-links a:hover,
.highlight-links a:focus {
  outline: 3px solid #FFD700 !important;
  outline-offset: 2px !important;
  background-color: rgba(255, 215, 0, 0.35) !important;
}

/* Increase Spacing */
.increase-spacing body {
  letter-spacing: 0.12em !important;
  word-spacing: 0.16em !important;
  line-height: 1.8 !important;
}
.increase-spacing p,
.increase-spacing li,
.increase-spacing span,
.increase-spacing div {
  line-height: 1.8 !important;
}

/* Grayscale Mode */
.grayscale-mode body {
  filter: grayscale(100%) !important;
}
.grayscale-mode .leaflet-container {
  filter: grayscale(100%) !important;
}

/* Big Cursor */
.big-cursor,
.big-cursor * {
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Cpath d='M8 4l28 20H20l8 16-5 2-8-16-7 7z' fill='%23000' stroke='%23fff' stroke-width='2'/%3E%3C/svg%3E") 4 4, auto !important;
}

/* Stop Animations */
.stop-animations *,
.stop-animations *::before,
.stop-animations *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  scroll-behavior: auto !important;
}

/* Accessibility menu panel animation */
@keyframes a11y-slide-up {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.a11y-panel-enter {
  animation: a11y-slide-up 0.2s ease-out;
}
```

---

### FILE 3: `src/app/layout.tsx` (MODIFY)

Import and render the `AccessibilityMenu` component. Add it inside the `<body>` tag, after `<Footer />` and before the closing `</body>`:

```typescript
import { AccessibilityMenu } from "@/components/AccessibilityMenu";
```

Then in the JSX, after `<Footer />`:

```tsx
<Footer />
<AccessibilityMenu />
```

Also add the OpenDyslexic font preconnect in `<head>` (alongside the existing leaflet link):

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
```

The actual OpenDyslexic font stylesheet will be dynamically injected by the AccessibilityMenu component ONLY when the dyslexia font feature is enabled, to avoid loading it unnecessarily:

```typescript
// Inside AccessibilityMenu, when dyslexia font is toggled ON:
if (!document.getElementById("dyslexia-font-link")) {
  const link = document.createElement("link");
  link.id = "dyslexia-font-link";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=OpenDyslexic&display=swap";
  document.head.appendChild(link);
}
```

---

### Keyboard & Focus Behavior

1. When the menu opens, focus moves to the close button (first focusable element in the dialog)
2. Tab cycles through: close button → font size buttons → each toggle switch → reset button → wraps back to close
3. Escape key closes the menu and returns focus to the toggle button
4. Shift+Tab cycles backwards
5. The backdrop `<div>` is not focusable

Implement this with a `useEffect` that captures Tab and Escape keys when `isOpen` is true:

```typescript
useEffect(() => {
  if (!isOpen) return;
  const panel = panelRef.current;
  if (!panel) return;

  const focusableElements = panel.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];

  first?.focus();

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      close();
      toggleButtonRef.current?.focus();
      return;
    }
    if (e.key !== "Tab") return;
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  }

  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}, [isOpen]);
```

---

### ARIA attributes checklist

- Toggle button: `aria-label="Open accessibility menu"`, `aria-expanded={isOpen}`
- Panel: `role="dialog"`, `aria-label="Accessibility settings"`, `aria-modal="true"`
- Each toggle switch: `role="switch"`, `aria-checked={value}`, `aria-label="{feature name}"`
- Font size buttons: `aria-label="Decrease font size"`, `aria-label="Reset font size"`, `aria-label="Increase font size"`
- Reset button: `aria-label="Reset all accessibility settings"`
- Close button: `aria-label="Close accessibility menu"`

---

### Dark mode compatibility

The AccessibilityMenu should respect the existing `.dark` class on `<html>`. Use Tailwind dark variants for the menu's own styling:
- Menu panel bg: `bg-white dark:bg-gray-900`
- Text: `text-gray-900 dark:text-gray-100`
- Borders: `border-gray-200 dark:border-gray-700`
- Toggle inactive bg: `bg-gray-200 dark:bg-gray-700`
- Toggle active bg: `bg-red-500` (same in both modes)
- The high-contrast mode should override both light and dark mode styles (its `!important` rules handle this)

---

### Testing checklist after implementation:

1. Click the ♿ button in bottom-left → menu opens with slide-up animation
2. Click each toggle → verify class appears on `<html>` element in DevTools
3. Refresh the page → all settings should persist (check localStorage key `dajsrce-a11y`)
4. Tab through the entire menu → focus should cycle correctly without escaping
5. Press Escape → menu closes, focus returns to the ♿ button
6. Enable high contrast → entire page should go black bg / white text / yellow links
7. Enable dyslexia font → text should change to OpenDyslexic across the page
8. Enable increase spacing → text should become more spread out
9. Enable grayscale → page and map should lose all color
10. Enable big cursor → cursor should become a large black pointer everywhere
11. Enable stop animations → no transitions or animations should play
12. Click "Reset All Settings" → everything returns to default
13. Check that the ♿ button does NOT overlap with the map zoom controls (Leaflet zoom is top-left by default, so bottom-left should be clear)
14. Test on mobile (320px width) → menu should still be usable and not overflow
15. Test with screen reader (VoiceOver/NVDA) → all buttons should be announced correctly
