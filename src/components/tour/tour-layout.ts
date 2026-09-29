/**
 * Where the walkthrough card goes and where its arrow runs, as plain geometry
 * so the rules can be tested without a browser.
 *
 * Wide screens put the card beside the highlighted control (below, above, to
 * the right, to the left, in that order of preference). Phones dock it to the
 * edge the control is not near, full width. When nothing fits beside a large
 * control, such as the map itself, the card docks at the bottom over it and
 * the arrow is dropped rather than drawn through the card.
 */

export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type Placement = "bottom" | "top" | "right" | "left" | "dock-bottom" | "dock-top" | "center";

export type TourLayout = {
  placement: Placement;
  card: Point;
  cardWidth: number;
  spot: Rect | null;
  arrow: { from: Point; to: Point; bend: Point } | null;
};

export const EDGE = 16;
const GAP = 64;
const SPOT_PAD = 8;
const PHONE_BREAKPOINT = 640;
const MAX_CARD_WIDTH = 384;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function cardWidthFor(viewport: Size): number {
  return Math.min(MAX_CARD_WIDTH, viewport.width - EDGE * 2);
}

/** The target padded for the spotlight and kept inside the viewport. */
export function spotFor(target: Rect, viewport: Size): Rect | null {
  const left = clamp(target.left - SPOT_PAD, 4, viewport.width - 4);
  const top = clamp(target.top - SPOT_PAD, 4, viewport.height - 4);
  const right = clamp(target.left + target.width + SPOT_PAD, 4, viewport.width - 4);
  const bottom = clamp(target.top + target.height + SPOT_PAD, 4, viewport.height - 4);
  if (right - left < 4 || bottom - top < 4) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

/** A gentle curve: the control point sits off the straight line, to one side. */
function bendFor(from: Point, to: Point): Point {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const offset = Math.min(40, length * 0.28);
  return { x: mx + (-dy / length) * offset, y: my + (dx / length) * offset };
}

function arrowBetween(card: Rect, spot: Rect): TourLayout["arrow"] {
  if (overlaps(card, spot)) return null;
  const spotCx = spot.left + spot.width / 2;
  const spotCy = spot.top + spot.height / 2;
  let from: Point;
  let to: Point;
  if (card.top >= spot.top + spot.height) {
    from = { x: clamp(spotCx, card.left + 32, card.left + card.width - 32), y: card.top - 6 };
    to = { x: clamp(from.x, spot.left + 12, spot.left + spot.width - 12), y: spot.top + spot.height + 6 };
  } else if (card.top + card.height <= spot.top) {
    from = { x: clamp(spotCx, card.left + 32, card.left + card.width - 32), y: card.top + card.height + 6 };
    to = { x: clamp(from.x, spot.left + 12, spot.left + spot.width - 12), y: spot.top - 6 };
  } else if (card.left >= spot.left + spot.width) {
    from = { x: card.left - 6, y: clamp(spotCy, card.top + 32, card.top + card.height - 32) };
    to = { x: spot.left + spot.width + 6, y: clamp(from.y, spot.top + 12, spot.top + spot.height - 12) };
  } else {
    from = { x: card.left + card.width + 6, y: clamp(spotCy, card.top + 32, card.top + card.height - 32) };
    to = { x: spot.left - 6, y: clamp(from.y, spot.top + 12, spot.top + spot.height - 12) };
  }
  if (Math.hypot(to.x - from.x, to.y - from.y) < 18) return null;
  return { from, to, bend: bendFor(from, to) };
}

export function layoutTour(viewport: Size, target: Rect | null, card: Size): TourLayout {
  const cardWidth = cardWidthFor(viewport);
  const height = card.height;
  const spot = target ? spotFor(target, viewport) : null;

  if (!spot) {
    return {
      placement: "center",
      card: {
        x: (viewport.width - cardWidth) / 2,
        y: Math.max(EDGE, (viewport.height - height) / 2),
      },
      cardWidth,
      spot: null,
      arrow: null,
    };
  }

  const spotCx = spot.left + spot.width / 2;
  const spotCy = spot.top + spot.height / 2;
  const fitsX = (x: number) => clamp(x, EDGE, viewport.width - cardWidth - EDGE);
  const fitsY = (y: number) => clamp(y, EDGE, viewport.height - height - EDGE);

  const candidates: { placement: Placement; x: number; y: number; ok: boolean }[] =
    viewport.width < PHONE_BREAKPOINT
      ? []
      : [
          {
            placement: "bottom",
            x: fitsX(spotCx - cardWidth / 2),
            y: spot.top + spot.height + GAP,
            ok: spot.top + spot.height + GAP + height <= viewport.height - EDGE,
          },
          {
            placement: "top",
            x: fitsX(spotCx - cardWidth / 2),
            y: spot.top - GAP - height,
            ok: spot.top - GAP - height >= EDGE,
          },
          {
            placement: "right",
            x: spot.left + spot.width + GAP,
            y: fitsY(spotCy - height / 2),
            ok: spot.left + spot.width + GAP + cardWidth <= viewport.width - EDGE,
          },
          {
            placement: "left",
            x: spot.left - GAP - cardWidth,
            y: fitsY(spotCy - height / 2),
            ok: spot.left - GAP - cardWidth >= EDGE,
          },
        ];

  const beside = candidates.find((candidate) => candidate.ok);
  let placement: Placement;
  let point: Point;
  if (beside) {
    placement = beside.placement;
    point = { x: beside.x, y: beside.y };
  } else {
    // Dock to the edge that leaves the control visible. A control in the lower
    // half prefers the top edge; either way, an edge whose card would cover
    // the control loses to one that does not.
    const x = (viewport.width - cardWidth) / 2;
    const docks = [
      { placement: "dock-top" as const, y: EDGE },
      { placement: "dock-bottom" as const, y: Math.max(EDGE, viewport.height - height - EDGE) },
    ];
    if (spotCy <= viewport.height / 2) docks.reverse();
    const clear = docks.find(
      (dock) => !overlaps({ left: x, top: dock.y, width: cardWidth, height }, spot)
    );
    const dock = clear ?? docks[0];
    placement = dock.placement;
    point = { x, y: dock.y };
  }

  const cardRect: Rect = { left: point.x, top: point.y, width: cardWidth, height };
  return { placement, card: point, cardWidth, spot, arrow: arrowBetween(cardRect, spot) };
}
