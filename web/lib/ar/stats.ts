// Live numbers for the AR debug panel (open a call page with ?debug=ar) and for the e2e test, which
// reads `window.arguideStats`. Nothing here changes behaviour.

/** Counts events in the last second. */
export function meter() {
  const times: number[] = [];
  const trim = (now: number) => {
    while (times.length && times[0] <= now - 1000) times.shift();
  };
  return {
    tick(now: number) {
      times.push(now);
      trim(now);
    },
    perSecond(now: number) {
      trim(now);
      return times.length;
    },
  };
}

export const arStats = {
  trackFps: 0,
  trackMs: 0, // time the tracker took for the latest picture
  trackSize: 0, // longer side of the analysed picture, in pixels
  handFps: 0,
  handMs: 0, // round trip to the hand recogniser for the latest picture
  handDelay: 0, // age of that picture when its result arrived
  gesture: "",
  score: 0,
  pinch: 0, // finger gap in palm widths; below 0.35 starts a pinch, above 0.55 ends it
  strokesStarted: 0,
  strokesEnded: 0,
};

if (typeof window !== "undefined") (window as unknown as { arguideStats: typeof arStats }).arguideStats = arStats;
