// Hands-free control for the technician: turns hand positions (from MediaPipe, see use-hands.ts) into
// actions. Pure logic, so it is tested without a camera (hands.test.ts).
//
//   point with the index finger     -> "point" (the expert sees a pointer at the fingertip)
//   pinch thumb and index, move     -> "draw-start", "draw-move"..., "draw-end" (one unbroken line)
//   open palm, moved (rubbing)      -> "erase-ready", "erase-move"..., "erase-end" (starts at once, no hold)

export interface Landmark {
  x: number; // fractions of the picture
  y: number;
  z: number;
}

const HAND_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15],
  [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [17, 0],
] as const;

/** Connections for the visible hand guide; reject incomplete recognizer results. */
export function handConnections(points: Landmark[]): [Landmark, Landmark][] {
  if (points.length < 21 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return [];
  return HAND_EDGES.map(([a, b]) => [points[a], points[b]]);
}

/**
 * Is the hand open, with all four fingers out? Worked out from the finger joints (each fingertip must be farther from
 * the wrist than the finger's middle joint), so it does not depend on the recogniser's gesture label being confident,
 * which it often is not in a dark room or on a moving hand.
 */
export function isOpenHand(points: Landmark[]): boolean {
  if (points.length < 21) return false;
  const reach = (i: number) => Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y);
  return [[6, 8], [10, 12], [14, 16], [18, 20]].every(([middle, tip]) => reach(tip) > reach(middle) * 1.15);
}

/** One hand as seen in one picture. `gesture` is MediaPipe's name for it ("Open_Palm", "None", ...). */
export interface HandFrame {
  landmarks: Landmark[];
  gesture: string;
  score: number;
}

export type HandEvent =
  | { type: "point"; at: [number, number] }
  | { type: "draw-start"; at: [number, number] }
  | { type: "draw-move"; at: [number, number] }
  | { type: "draw-end" }
  | { type: "erase-ready" }
  | { type: "erase-move"; at: [number, number]; radius: number }
  | { type: "erase-end" }
  | { type: "gone" };

// Tuning knobs (test on the owner's phone; see docs/AR_CORE_PLAN.md Stage 3).
const PINCH_ON = 0.35; // finger gap / palm width below which a pinch starts
const PINCH_OFF = 0.55; // ... and above which it ends (the gap between the two stops broken lines)
// Counted in pictures, not milliseconds, so a slow phone (few hand results a second) behaves like a fast one:
// one misread or missing picture can never start, end or break anything on its own.
const CONFIRM_FRAMES = 2; // pictures in a row a pinch change or an open palm must last
const GONE_FRAMES = 3; // pictures in a row without a hand ...
const GONE_MS = 90; // ... lasting at least this long, before the hand counts as gone
const ERASE_GRACE_FRAMES = 3; // pictures a rub may lose its open-palm pose before it ends
const ERASE_MOVE = 0.02; // how far the palm must move (share of the width) before it rubs
const PALM_SCORE = 0.6;
const SMOOTH = { minCutoff: 1, beta: 4, dCutoff: 1 }; // One Euro filter: steady when still, quick when moving

const TIP = 8, THUMB = 4, WRIST = 0, INDEX_KNUCKLE = 5, LITTLE_KNUCKLE = 17;

/** One Euro filter (Casiez et al., 2012): little smoothing when moving fast, a lot when still. */
function oneEuro() {
  let x: number | null = null, dx = 0, t = 0;
  const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  return {
    next(value: number, ms: number) {
      if (x === null) {
        x = value;
        t = ms;
        return value;
      }
      const dt = Math.max(1e-3, (ms - t) / 1000);
      t = ms;
      dx += alpha(SMOOTH.dCutoff, dt) * ((value - x) / dt - dx);
      x += alpha(SMOOTH.minCutoff + SMOOTH.beta * Math.abs(dx), dt) * (value - x);
      return x;
    },
    reset() {
      x = null;
      dx = 0;
    },
  };
}

export function createHands() {
  const fx = oneEuro(), fy = oneEuro();
  let pinched = false, changeFrames = 0, lastSeen = 0, missing = 0, present = false;
  let palmFrames = 0, palmLost = 0, palmX = 0, palmY = 0, erasing = false;
  let lastGap = 0;

  return {
    /** The latest finger gap in palm widths (for the AR debug panel). */
    gap: () => lastGap,
    /** Feed one picture's hand (or null). `aspect` = picture width / height. Returns what happened. */
    update(hand: HandFrame | null, ms: number, aspect: number): HandEvent[] {
      const out: HandEvent[] = [];
      if (!hand) {
        missing++;
        if (present && missing >= GONE_FRAMES && ms - lastSeen >= GONE_MS) {
          if (pinched) out.push({ type: "draw-end" });
          if (erasing) out.push({ type: "erase-end" });
          out.push({ type: "gone" });
          pinched = present = erasing = false;
          changeFrames = palmFrames = palmLost = 0;
          fx.reset();
          fy.reset();
        }
        return out;
      }
      lastSeen = ms;
      missing = 0;
      present = true;
      const p = hand.landmarks;
      const dist = (a: Landmark, b: Landmark) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
      const at: [number, number] = [fx.next(p[TIP].x, ms), fy.next(p[TIP].y, ms)];
      out.push({ type: "point", at });

      // Pinch: finger gap measured in palm widths, so it works with the hand near or far.
      const gap = dist(p[THUMB], p[TIP]) / Math.max(1e-6, dist(p[INDEX_KNUCKLE], p[LITTLE_KNUCKLE]));
      lastGap = gap;
      const changing = pinched ? gap > PINCH_OFF : gap < PINCH_ON;
      changeFrames = changing ? changeFrames + 1 : 0;
      if (changeFrames >= CONFIRM_FRAMES) {
        pinched = !pinched;
        changeFrames = 0;
        out.push(pinched ? { type: "draw-start", at } : { type: "draw-end" });
      } else if (pinched) out.push({ type: "draw-move", at });

      // Rubbing: an open palm, seen in two pictures in a row, that then moves. A still open hand erases nothing.
      const palm = !pinched && ((hand.gesture === "Open_Palm" && hand.score >= PALM_SCORE) || isOpenHand(p));
      if (!palm) {
        if (erasing && ++palmLost < ERASE_GRACE_FRAMES) return out; // a misread picture: keep rubbing
        if (erasing) out.push({ type: "erase-end" });
        erasing = false;
        palmFrames = palmLost = 0;
        return out;
      }
      palmLost = 0;
      if (++palmFrames < CONFIRM_FRAMES) return out;
      const wx = p[WRIST].x, wy = p[WRIST].y;
      if (palmFrames === CONFIRM_FRAMES) [palmX, palmY] = [wx, wy];
      if (!erasing && Math.hypot((wx - palmX) * aspect, wy - palmY) >= ERASE_MOVE) {
        erasing = true;
        out.push({ type: "erase-ready" });
      }
      if (erasing) {
        const a = p[INDEX_KNUCKLE], b = p[LITTLE_KNUCKLE], wrist = p[WRIST];
        out.push({ type: "erase-move", at: [(a.x + b.x + wrist.x) / 3, (a.y + b.y + wrist.y) / 3], radius: Math.min(0.12, Math.max(0.02, dist(a, b) * 0.55)) });
      }
      return out;
    },
  };
}

/** The area the hand covers (with a margin), so the tracker ignores it: a hand is not part of the aircraft. */
export function handBox(hand: HandFrame) {
  const xs = hand.landmarks.map((l) => l.x), ys = hand.landmarks.map((l) => l.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const mx = (x1 - x0) * 0.15, my = (y1 - y0) * 0.15;
  return { x: x0 - mx, y: y0 - my, w: x1 - x0 + 2 * mx, h: y1 - y0 + 2 * my };
}
