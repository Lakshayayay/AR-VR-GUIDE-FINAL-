import type { Placements } from "@/lib/annotations";

/** Pictures are analysed at one of these sizes (longer side, pixels). Bigger is more exact but slower. */
const SIZES = [480, 640, 960];
/** The tracker may move up a size when its average time per picture is at most this (a 30 a second camera gives it 33 ms). */
const RAISE_MS = 12;

/**
 * Adapts the analysis size to the tracker's speed, in 3-second windows. Under 24 pictures a second: a size
 * down (and that size becomes the ceiling for good, so it does not bounce); at the bottom, "limited".
 * Keeping up with time to spare: a size up, until the ceiling. Without timings it only ever goes down.
 */
export function trackingQuality() {
  let level = 1, ceiling = SIZES.length - 1, start: number | null = null, previous: number | null = null;
  let frames = 0, msSum = 0, timed = 0, slow = false;
  return {
    frame(now: number, ms?: number) {
      if (start === null || (previous !== null && now - previous > 1000)) {
        start = now;
        frames = msSum = timed = 0;
      }
      previous = now;
      frames++;
      if (ms !== undefined) {
        msSum += ms;
        timed++;
      }
      const elapsed = now - start;
      if (elapsed >= 3000) {
        const fps = (frames - 1) * 1000 / elapsed;
        if (fps < 24) {
          if (level > 0) ceiling = --level;
          else slow = true;
        } else {
          slow = false;
          if (level < ceiling && timed > 0 && msSum / timed <= RAISE_MS) level++;
        }
        start = now;
        frames = 1;
        msSum = timed = 0;
      }
    },
    reset() { start = previous = null; frames = msSum = timed = 0; slow = false; },
    size() { return SIZES[level]; },
    limited() { return slow; },
  };
}

/**
 * A drawing the tracker has just lost keeps its last place, drawn solid ("holding"), for `graceMs` before it is
 * shown as lost (faded, dashed). A hand passing in front or a blink of the camera must not make a line flicker.
 * `lostAt` remembers when each drawing was lost; pass the same map every time.
 */
export function holdLost(placements: Placements, lostAt: Map<string, number>, now: number, graceMs = 500): Placements {
  const out: Placements = {};
  for (const [id, p] of Object.entries(placements)) {
    if (p.state !== "searching") {
      lostAt.delete(id);
      out[id] = p;
    } else {
      if (!lostAt.has(id)) lostAt.set(id, now);
      out[id] = now - lostAt.get(id)! < graceMs ? { ...p, state: "holding" } : p;
    }
  }
  for (const id of [...lostAt.keys()]) if (!(id in placements)) lostAt.delete(id);
  return out;
}

/** The entry captured closest in time to `t` (the hand and the tracker each look at a picture of their own). */
export function nearest<T extends { capturedAt: number }>(log: T[], t: number): T | undefined {
  let best: T | undefined;
  for (const entry of log) if (!best || Math.abs(entry.capturedAt - t) < Math.abs(best.capturedAt - t)) best = entry;
  return best;
}

/**
 * What the user should be told about their drawings: "lost" (some were drawn on a part the camera no longer sees;
 * they show dashed), "fixed" (some cannot be attached here at all, too dark or too plain, and stay where drawn on
 * the screen), or "" (nothing to say). Lost wins: it is the one that needs action.
 */
export function trackingNotice(placements: Placements): "" | "lost" | "fixed" {
  const states = Object.values(placements).map((p) => p.state);
  return states.includes("searching") ? "lost" : states.includes("fixed") ? "fixed" : "";
}
