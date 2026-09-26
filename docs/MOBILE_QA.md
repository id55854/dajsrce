# Mobile interaction verification — 26 September 2026

The main mobile fixes are in `42594a9` (based on the remote update through
`6f22bd3`). The follow-up change constrains shared dialogs to the viewport and
makes their contents scrollable. No database migration is needed.

## Findings and changes

| Problem | Change |
| --- | --- |
| Opening filters displaced the county list and left results exposed below the scrim. | Render the filter surface in a fixed body portal, outside the map's clipped stacking context; focus without scrolling its ancestors. |
| Dropdowns could close when focus/keyboard changes caused scrolling or resizing. | Reposition open pickers against the visual viewport instead of dismissing them; keep their own lists scrollable. |
| Results only scrolled at the full sheet position, with the bottom of the list outside the viewport. | Size the scroll area to the visible sheet height at every position. |
| Search suggestions inherited the sheet header's disabled touch gestures. | Keep interactive header content outside the handle's gesture surface. |
| Inline close handlers made dialog effects restart during rerenders. | Keep the trap mounted and call the current close callback through a ref. |
| Closed dropdown options participated in the focus trap. | Only include rendered, non-inert controls. |
| City selection disappeared after reload/sharing. | Include `city` in the browser URL serialization and test the round trip. |
| The platform-only switch did not count as an active filter. | Include it in the filter badge and clear-state calculation. |
| A short landscape sidebar clipped filters/results. | Allow the entire sidebar content to scroll on short screens. |
| Mobile navigation changed the map's available page height. | Position the menu below the header, bound its height, and enable scrolling; dismiss on Escape/outside press. Remove the unused header border that added page overflow. |
| Event dialogs extended above and below a landscape phone viewport. | Bound shared dialogs to `100dvh - 2rem` with internal scrolling and contained overscroll. |

## Browser verification

Tested in the Codex Chromium browser against the local app using real public
backend reads. The original displaced filter panel was also reproduced on
the production website before changes.

- 390 × 844: city search/selection, two organisation types, two donation types,
  Done, Close, clear filters, reopening, and scrolling county results to the
  final rows at the middle sheet position.
- 320 × 568: filter/dialog bounds and dropdown content stay inside the viewport;
  Escape dismisses the dropdown before the enclosing filter panel.
- 844 × 390: rotating with filters open releases the mobile dialog/scroll lock;
  short desktop-style sidebar can scroll through filters and results.
- 667 × 375: event dialog stays between y=16 and y=359; its signup action is
  reachable through internal scrolling and opens the guest sign-in prompt.
- 1440 × 900: desktop organisation filtering works; no horizontal overflow or
  residual body scroll lock after leaving the mobile layout.
- A selected city and the platform-only filter persist together after a full
  page reload, including the correct active-filter count.
- Mobile search → organisation detail → browser Back returns to results.
- Donation page: expand filters, select a donation type, open and close the
  guest sign-in prompt.
- Volunteering page: open event details, inspect location/capacity, follow the
  guest signup action, close the sign-in prompt, navigate back to the map.

## Automated checks

- `npm run check`: lint and typecheck pass; 366 tests across 47 files pass.
- `npm run build`: production build passes.
- `npm audit`: zero vulnerabilities (25 September, dependency set unchanged).
- Regression tests cover focus stability during rerenders, current Escape
  callbacks, focus without ancestor scrolling, hidden-option exclusion, nested
  scroll-lock release, and filter URL round trips.

## Verification limits

Responsive Chromium checks do not certify physical iOS Safari or Android
touch/keyboard behavior. Check opening a city/category picker, typing with the
on-screen keyboard, scrolling options, and dragging the result handle on those
devices before release. Signed-in donor/NGO workflows were not exercised in this
pass; public browsing and guest sign-in gates were checked without creating
donations, volunteer signups, or other production records.
