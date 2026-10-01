/**
 * Where organisation-name labels fit over single map pins. Pure screen-space
 * geometry, kept apart from the Leaflet component so it can be tested.
 */

/** Must match `.dajsrce-pin-label` in globals.css. */
export const PIN_LABEL_HEIGHT = 22;
/** Distance from the pin's top to the label's bottom edge. */
export const PIN_LABEL_GAP = 4;
const PIN_LABEL_MARGIN = 4;
/**
 * A pin with more than this many others within the radius is not labelled.
 * 72 px rejected nearly every pin in central Zagreb on a phone (one label
 * on screen at zoom 15); the overlap tests already keep labels apart, so this
 * only has to catch a tight knot of pins.
 */
const CROWD_RADIUS = 48;
const CROWD_MAX_NEIGHBOURS = 3;

export type ScreenBox = { left: number; top: number; right: number; bottom: number };

function boxesOverlap(a: ScreenBox, b: ScreenBox, margin: number): boolean {
  return (
    a.left < b.right + margin &&
    b.left < a.right + margin &&
    a.top < b.bottom + margin &&
    b.top < a.bottom + margin
  );
}

/**
 * Greedy screen-space label placement, in priority order (lower first, then
 * top to bottom). Returns the ids whose label is drawn.
 */
export function planPinLabels(
  pins: Array<{
    id: string;
    x: number;
    y: number;
    size: number;
    priority: number;
    labelWidth: number;
  }>,
  viewport: { width: number; height: number },
  /** Map chrome floating over the map (zoom, locate, city buttons). */
  obstacles: readonly ScreenBox[] = []
): Set<string> {
  const pinBoxes = pins.map((pin) => ({
    id: pin.id,
    box: {
      left: pin.x - pin.size / 2,
      top: pin.y - pin.size,
      right: pin.x + pin.size / 2,
      bottom: pin.y,
    },
  }));
  const placed: ScreenBox[] = [];
  const labelled = new Set<string>();
  const order = [...pins].sort((a, b) => a.priority - b.priority || a.y - b.y);

  for (const pin of order) {
    const neighbours = pins.filter(
      (other) =>
        other.id !== pin.id && Math.hypot(other.x - pin.x, other.y - pin.y) <= CROWD_RADIUS
    ).length;
    if (neighbours > CROWD_MAX_NEIGHBOURS) continue;

    const bottom = pin.y - pin.size - PIN_LABEL_GAP;
    const box: ScreenBox = {
      left: pin.x - pin.labelWidth / 2,
      right: pin.x + pin.labelWidth / 2,
      top: bottom - PIN_LABEL_HEIGHT,
      bottom,
    };
    if (
      box.left < PIN_LABEL_MARGIN ||
      box.top < PIN_LABEL_MARGIN ||
      box.right > viewport.width - PIN_LABEL_MARGIN ||
      box.bottom > viewport.height - PIN_LABEL_MARGIN
    ) {
      continue;
    }
    if (placed.some((other) => boxesOverlap(box, other, PIN_LABEL_MARGIN))) continue;
    if (obstacles.some((other) => boxesOverlap(box, other, PIN_LABEL_MARGIN))) continue;
    if (
      pinBoxes.some(
        (other) => other.id !== pin.id && boxesOverlap(box, other.box, PIN_LABEL_MARGIN / 2)
      )
    ) {
      continue;
    }
    placed.push(box);
    labelled.add(pin.id);
  }
  return labelled;
}

