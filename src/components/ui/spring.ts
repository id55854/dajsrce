/**
 * A minimal spring integrator and the momentum-projection function that make
 * gesture-driven motion feel physical, without pulling in an animation library.
 *
 * Why a spring rather than a CSS transition: a transition has a fixed duration
 * and always starts from wherever it was told to start. A spring is defined by
 * a target, so new input just re-targets it, and it can absorb the velocity the
 * finger was carrying at release. That is what makes motion interruptible.
 */

/**
 * Where a flick would come to rest, using the exponential-decay model that
 * matches native scroll deceleration. The textbook `v²/(2a)` is *not* what
 * feels right here; this is the form UIKit's own sample code uses.
 *
 * @param velocity px/s at release
 * @param decelerationRate 0.998 for a normal scroll feel, 0.99 for snappier
 */
export function projectMomentum(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Progressive resistance past a boundary: the further beyond the edge, the less
 * the element follows the finger. A hard stop reads as "frozen"; this reads as
 * "responsive, but there is nothing more here".
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (
    (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
  );
}

export type SpringHandle = { cancel: () => void };

/**
 * Critically damped by default (`damping ≈ 2·√stiffness`), so it settles
 * without overshoot; the correct default for UI that did not arrive on a
 * flick. Lower the damping to let a thrown surface overshoot slightly.
 */
export function animateSpring({
  from,
  to,
  velocity = 0,
  stiffness = 220,
  damping = 30,
  onFrame,
  onDone,
}: {
  from: number;
  to: number;
  velocity?: number;
  stiffness?: number;
  damping?: number;
  onFrame: (value: number) => void;
  onDone?: () => void;
}): SpringHandle {
  let position = from;
  let speed = velocity;
  let raf = 0;
  let last = performance.now();
  let cancelled = false;

  function step(now: number) {
    if (cancelled) return;
    // Clamp dt so a backgrounded tab cannot integrate a huge step and explode.
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    const acceleration = -stiffness * (position - to) - damping * speed;
    speed += acceleration * dt;
    position += speed * dt;

    if (Math.abs(position - to) < 0.5 && Math.abs(speed) < 20) {
      onFrame(to);
      onDone?.();
      return;
    }

    onFrame(position);
    raf = requestAnimationFrame(step);
  }

  raf = requestAnimationFrame(step);

  return {
    cancel() {
      cancelled = true;
      cancelAnimationFrame(raf);
    },
  };
}

/** Tracks recent pointer samples so release velocity reflects the last motion, not the whole drag. */
export class VelocityTracker {
  private samples: Array<{ value: number; time: number }> = [];

  add(value: number, time = performance.now()) {
    this.samples.push({ value, time });
    // ~100ms of history is enough to be responsive without being jittery.
    while (this.samples.length > 2 && time - this.samples[0]!.time > 100) {
      this.samples.shift();
    }
  }

  /** px per second. Zero when the pointer was effectively still. */
  velocity(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    const dt = (last.time - first.time) / 1000;
    if (dt <= 0) return 0;
    return (last.value - first.value) / dt;
  }

  reset() {
    this.samples = [];
  }
}
