const MARKER_ENTER = "animation: ui-marker-in 180ms ease-out both;";

/**
 * One marker silhouette for the whole map. A cluster and a pin differ only by
 * fill and by whether they carry a count, previously clusters were blue/red
 * circles set in `system-ui` while pins were category-coloured teardrops, so a
 * zoom step read as a change of subject rather than a change of scale.
 *
 * Colours are theme tokens (`--surface-raised`, `--ink`, `--brand`,
 * `--warning`), so the icons follow the theme without being rebuilt on a flip.
 */
function markerHtml({
  fill,
  size,
  selected = false,
  label,
  urgent = false,
  verified = false,
}: {
  fill: string;
  size: number;
  selected?: boolean;
  label?: string;
  urgent?: boolean;
  verified?: boolean;
}): string {
  const ring = selected
    ? `0 0 0 3px var(--ink), 0 0 0 7px color-mix(in oklab, ${fill} 45%, transparent), `
    : "";
  const count = label
    ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 ${
        size >= 48 ? 14 : 12
      }px/1 var(--font-app-sans);color:#fff;">${label}</span>`
    : "";
  const flag = urgent
    ? `<span style="position:absolute;top:-1px;right:-1px;width:12px;height:12px;border-radius:9999px;background:var(--warning);border:2px solid var(--surface-raised);"></span>`
    : "";
  // Verified organisations carry a filled check-mark disc. Shape as well as
  // colour, so the distinction survives a monochrome or colour-blind reading.
  const check = verified
    ? `<span style="position:absolute;right:-3px;bottom:2px;width:14px;height:14px;border-radius:9999px;background:var(--success);border:2px solid var(--surface-raised);display:flex;align-items:center;justify-content:center;">
        <svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </span>`
    : "";
  return `<div style="position:relative;width:${size}px;height:${size}px;${MARKER_ENTER}">
    <div style="position:absolute;inset:0;background:${fill};border:3px solid var(--surface-raised);border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:${ring}0 2px 6px rgba(0,0,0,.35);"></div>
    ${count}${flag}${check}
  </div>`;
}

function clusterCaptionHtml(placeName: string, size: number): string {
  const escaped = placeName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<span aria-hidden="true" style="
    position:absolute;top:${size + 2}px;left:50%;transform:translateX(-50%);
    max-width:140px;padding:1px 6px;border-radius:6px;
    font:600 11px/1.35 var(--font-app-sans);white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis;
    color:var(--ink);background:color-mix(in oklab, var(--surface-raised) 88%, transparent);
    box-shadow:0 1px 3px rgba(0,0,0,.28);pointer-events:none;
  ">${escaped}</span>`;
}


export { markerHtml, clusterCaptionHtml };
