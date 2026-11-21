// Keeps each drawing glued to the part it was drawn on, while the camera moves.
//
// How: every drawing has an "anchor", a small grey picture of the area under it. On each video
// picture:
//   1. predict: follow the anchor's points from the last picture (Lucas-Kanade optical flow) and fit
//      how the area moved, turned, grew or tilted (a homography; RANSAC ignores a hand in front);
//   2. refine: un-warp the live picture back into the anchor picture's view and line the two up
//      again. Comparing with the original picture every time means errors cannot build up (no drift).
// When the area is lost, the anchor picture is searched for in the whole live picture (ORB features).
//
// Pure maths on grey pictures, no browser APIs, so it runs in a Web Worker and in Node tests.
// OpenCV is passed in (`cv`) because it loads differently in each place.

/** A grey picture, one byte a pixel. */
export interface Gray {
  data: Uint8Array;
  width: number;
  height: number;
}

/** A box in fractions (0 to 1) of the picture. */
export interface FracBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What travels with a drawing so the other side can find the same spot: the grey picture and where it was. */
export interface AnchorRef {
  patch: Gray;
  box: FracBox;
  exclude?: FracBox;
  /**
   * The drawing's own area (with a small margin), in the same terms as `box`. Features are taken from here
   * first, so a drawing on an object that moves follows the object, not the still background around it.
   */
  focus?: FracBox;
}

/**
 * Where a drawing is now. `h` maps points of the picture it was drawn on to the current picture
 * (both in fractions; 3x3, row by row). "searching": the part is out of view; `h` is its last place.
 */
export interface Placement {
  h: number[];
  state: "locked" | "fixed" | "searching";
}

/** Pictures are analysed at this size (longer side, pixels). Larger is steadier but slower on phones. */
export const ANALYSIS_LONG_SIDE = 640;

// Tuning knobs. Change with the test clips in hand (see docs/history/AR_CORE_PLAN.md, Stage 3).
const MIN_ANCHOR_SIDE = 0.5; // anchor area at least this share of the picture's shorter side
const MAX_PATCH_SIDE = 256; // the anchor picture is shrunk to this (it is also what is sent to the other side)
const CORNERS = 150; // points per anchor picture
// A corner point must be stronger than camera noise could make it, and the cut-off must not throw away real detail
// in a dark room. Edges get fainter with the square of the brightness, so below DIM_BELOW (average grey level) the
// cut-off comes down the same way; in a normally lit picture it is exactly MIN_CORNER_STRENGTH. It never goes
// below what noise can make (estimated as in `noiseSigma`: pure noise makes corners up to about
// NOISE_STRENGTH * sigma^2, measured with grain of +-12 grey levels, sigma 6.9, peaking at 0.00135; we want
// NOISE_MARGIN times that) or below MIN_CORNER_STRENGTH_DIM. The owner's dark-room webcam frame (average grey 31) had
// real detail up to about 0.0019 against noise up to about 0.00002, so the old fixed 0.002 threw nearly all of it away.
const MIN_CORNER_STRENGTH = 0.002; // a normally lit picture
const MIN_CORNER_STRENGTH_DIM = 0.0003; // the lowest it ever goes
const DIM_BELOW = 90;
const NOISE_STRENGTH = 2.8e-5;
const NOISE_MARGIN = 3;
const MIN_INLIERS = 10; // fewer points that agree than this: the drawing is lost
const FB_MAX_ERROR = 1; // a point must come back to within 1 px when followed backwards
const SEARCH_EVERY = 2; // pictures between searches for a lost drawing
// ponytail: keep the margin small: the more still background inside the area, the more the tracker prefers it
// over a moving object (tested: 4% follows a moving card, 20% does not). Upgrade: pick the object by motion.
const MIN_SIMILARITY = 0.35; // the anchor picture must look at least this much like the live picture where it is placed (-1..1)
const FOCUS_MARGIN = 0.04; // the drawing's own area is padded by this share of its size ...
const FOCUS_MIN_MARGIN = 0.01; // ... and by at least this much (fractions of the picture)
const FOCUS_MIN_CORNERS = 25; // fewer corner points than this in that area: widen it ...
const FOCUS_WIDEN = [1, 1.5, 2.25, 3.4, 0]; // ... by these factors in turn (0: the whole anchor area)
const ORB_FRAME_FEATURES = 1500;
const ORB_PATCH_FEATURES = 500;

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

interface Anchor {
  ref: AnchorRef;
  img: any; // the anchor picture (cv.Mat)
  roi: [number, number, number, number]; // x, y, width, height in the anchor picture that is compared with the live picture: the drawing's own area
  corners: number[]; // its corner points, anchor-picture pixels (x, y, x, y, ...)
  P: number[]; // anchor-picture pixels -> reference-picture pixels
  kp: number[]; // ORB keypoints of the anchor picture, reference-picture pixels
  desc: any; // their descriptors (cv.Mat)
  pts: number[]; // points found on the last picture, its pixels
  refPts: number[]; // the same points, reference-picture pixels
  h: number[] | null; // reference pixels -> current pixels; null while searching
  last: number[]; // last known h, shown while searching
  tries: number;
}

export function createTracker(cv: any) {
  const anchors = new Map<string, Anchor>();
  let prev: any = null; // last picture (cv.Mat)
  let W = 0;
  let H = 0;
  let frameOrb: { kp: number[]; desc: any } | null = null;

  const orbFor = (n: number) => new cv.ORB(n, 1.2, 6, 19, 0, 2, 0, 19, 12);
  const orbFrame = orbFor(ORB_FRAME_FEATURES);
  const orbPatch = orbFor(ORB_PATCH_FEATURES);
  const gftt = new cv.GFTTDetector(CORNERS, 0.01, 5);
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const lkWin = new cv.Size(21, 21);
  const lkTerm = new cv.TermCriteria(3, 20, 0.03);
  const none = new cv.Mat();

  const toMat = (g: Gray) => {
    const m = new cv.Mat(g.height, g.width, cv.CV_8UC1);
    m.data.set(g.data);
    return m;
  };
  const free = (...mats: any[]) => mats.forEach((m) => m.delete());

  const corners = (b: FracBox): [number, number][] => [
    [b.x * W, b.y * H], [(b.x + b.w) * W, b.y * H], [(b.x + b.w) * W, (b.y + b.h) * H], [b.x * W, (b.y + b.h) * H],
  ];

  /** Rejects placements that cannot be a real view of a flat area: folded, mirrored, absurd size, far away. */
  const plausible = (h: number[], box: FracBox) => {
    const q = corners(box).map(([x, y]) => applyH(h, x, y));
    if (!q.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return false;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4];
      if ((bx - ax) * (cy - by) - (by - ay) * (cx - bx) <= 0) return false; // folded or mirrored
    }
    const area = Math.abs(q.reduce((s, [x, y], i) => s + x * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * y, 0) / 2);
    const ratio = area / (box.w * W * box.h * H);
    const [mx, my] = applyH(h, (box.x + box.w / 2) * W, (box.y + box.h / 2) * H);
    return ratio > 1 / 16 && ratio < 16 && mx > -W && mx < 2 * W && my > -H && my < 2 * H;
  };

  const toFractions = (h: number[]) => {
    // F = S^-1 * h * S with S = diag(W, H, 1)
    const n = [h[0], (h[1] * H) / W, h[2] / W, (h[3] * W) / H, h[4], h[5] / H, h[6] * W, h[7] * H, h[8]];
    return n.map((v) => v / n[8]);
  };

  /** Fits a homography to point pairs; returns it and which pairs agree, or null. */
  const fit = (from: number[], to: number[], threshold: number) => {
    const n = from.length / 2;
    if (n < MIN_INLIERS) return null;
    const a = cv.matFromArray(n, 1, cv.CV_32FC2, from);
    const b = cv.matFromArray(n, 1, cv.CV_32FC2, to);
    const mask = new cv.Mat();
    const hm = cv.findHomography(a, b, cv.RANSAC, threshold, mask, 2000, 0.995);
    const h = hm.rows === 3 ? Array.from(hm.data64F as Float64Array) : null;
    const keep = Array.from(mask.data as Uint8Array).map(Boolean);
    free(a, b, mask, hm);
    if (!h || keep.filter(Boolean).length < MIN_INLIERS) return null;
    return { h, keep };
  };

  /** Lucas-Kanade from one picture to another, kept only where following back lands within FB_MAX_ERROR. */
  const lk = (from: any, to: any, pts: number[], levels: number, init?: number[]) => {
    const n = pts.length / 2;
    const p0 = cv.matFromArray(n, 1, cv.CV_32FC2, pts);
    const p1 = init ? cv.matFromArray(n, 1, cv.CV_32FC2, init) : new cv.Mat();
    const back = new cv.Mat(), st1 = new cv.Mat(), st2 = new cv.Mat(), e1 = new cv.Mat(), e2 = new cv.Mat();
    cv.calcOpticalFlowPyrLK(from, to, p0, p1, st1, e1, lkWin, levels, lkTerm, init ? cv.OPTFLOW_USE_INITIAL_FLOW : 0);
    cv.calcOpticalFlowPyrLK(to, from, p1, back, st2, e2, lkWin, levels, lkTerm);
    const fwd = Array.from(p1.data32F as Float32Array), bwd = p1.rows ? (back.data32F as Float32Array) : [];
    const ok = Array.from({ length: n }, (_, i) =>
      !!st1.data[i] && !!st2.data[i] && Math.hypot(bwd[i * 2] - pts[i * 2], bwd[i * 2 + 1] - pts[i * 2 + 1]) < FB_MAX_ERROR,
    );
    free(p0, p1, back, st1, st2, e1, e2);
    return { fwd, ok };
  };

  const inside = (b: FracBox | null, x: number, y: number) =>
    !!b && x >= b.x * W && x <= (b.x + b.w) * W && y >= b.y * H && y <= (b.y + b.h) * H;
  const inFrame = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

  /** Step 1: follows every locked anchor's points from the last picture, all in one go, and fits a prediction. */
  const predict = (cur: any, mask: FracBox | null) => {
    const live = [...anchors.values()].filter((a) => a.h && a.pts.length);
    const all = live.flatMap((a) => a.pts);
    if (!prev || !all.length) return;
    const { fwd, ok } = lk(prev, cur, all, 3);
    let i = 0;
    for (const a of live) {
      const from: number[] = [];
      const to: number[] = [];
      for (let k = 0; k < a.pts.length; k += 2, i++) {
        const x = fwd[i * 2], y = fwd[i * 2 + 1];
        if (ok[i] && inFrame(x, y) && !inside(mask, x, y)) from.push(a.refPts[k], a.refPts[k + 1]), to.push(x, y);
      }
      const found = fit(from, to, 2.5);
      if (found && plausible(found.h, a.ref.box)) a.h = found.h; // else keep the last place as the guess
    }
  };

  /**
   * How much the anchor picture looks like the live picture where `h` places it (normalised correlation, -1 to 1),
   * compared over the drawing's own area. Followed points can agree with each other and still be wrong (points
   * that never moved because they found nothing), so every placement is checked against what the camera sees.
   */
  const similarity = (a: Anchor, cur: any, h: number[]) => {
    const m = cv.matFromArray(3, 3, cv.CV_64F, mul(h, a.P));
    const unwarped = new cv.Mat();
    cv.warpPerspective(cur, unwarped, m, new cv.Size(a.ref.patch.width, a.ref.patch.height), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(0));
    const rect = new cv.Rect(...a.roi);
    const mine = a.img.roi(rect), live = unwarped.roi(rect), out = new cv.Mat();
    cv.matchTemplate(mine, live, out, cv.TM_CCOEFF_NORMED);
    const score = out.floatAt(0, 0);
    free(m, unwarped, mine, live, out);
    return Number.isFinite(score) ? score : 1; // a flat area has nothing to compare: do not reject on that
  };

  /** Step 2: lines the live picture up with the anchor picture again. Returns false if they no longer match. */
  const refine = (a: Anchor, cur: any, mask: FracBox | null, guess: number[]) => {
    if (a.corners.length / 2 < MIN_INLIERS) return false; // too little detail to hold on to
    const M = mul(guess, a.P); // anchor-picture pixels -> current pixels
    const m = cv.matFromArray(3, 3, cv.CV_64F, M);
    const unwarped = new cv.Mat();
    const size = new cv.Size(a.ref.patch.width, a.ref.patch.height);
    cv.warpPerspective(cur, unwarped, m, size, cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_CONSTANT, new cv.Scalar(0));
    const { fwd, ok } = lk(a.img, unwarped, a.corners, 2);
    free(m, unwarped);
    const from: number[] = [];
    const to: number[] = [];
    for (let i = 0; i < ok.length; i++) {
      if (!ok[i]) continue;
      const [x, y] = applyH(M, fwd[i * 2], fwd[i * 2 + 1]);
      if (!inFrame(x, y) || inside(mask, x, y)) continue;
      const [rx, ry] = applyH(a.P, a.corners[i * 2], a.corners[i * 2 + 1]);
      from.push(rx, ry);
      to.push(x, y);
    }
    const found = fit(from, to, 2);
    if (!found || !plausible(found.h, a.ref.box) || similarity(a, cur, found.h) < MIN_SIMILARITY) return false;
    a.h = a.last = found.h;
    a.pts = to.filter((_, j) => found.keep[j >> 1]);
    a.refPts = from.filter((_, j) => found.keep[j >> 1]);
    return true;
  };

  /** ORB features of the whole current picture, worked out at most once a picture. */
  const featuresOf = (cur: any) => {
    if (frameOrb) return frameOrb;
    const kps = new cv.KeyPointVector();
    const desc = new cv.Mat();
    orbFrame.detectAndCompute(cur, none, kps, desc);
    const kp: number[] = [];
    for (let i = 0; i < kps.size(); i++) kp.push(kps.get(i).pt.x, kps.get(i).pt.y);
    kps.delete();
    return (frameOrb = { kp, desc });
  };

  /** Finds the anchor picture anywhere in the current picture. Returns reference -> current pixels, or null. */
  const locate = (a: Anchor, cur: any) => {
    if (a.desc.rows < MIN_INLIERS) return null;
    const f = featuresOf(cur);
    if (f.desc.rows < MIN_INLIERS) return null;
    const matches = new cv.DMatchVectorVector();
    matcher.knnMatch(a.desc, f.desc, matches, 2);
    const from: number[] = [];
    const to: number[] = [];
    for (let i = 0; i < matches.size(); i++) {
      const pair = matches.get(i);
      if (pair.size() === 2 && pair.get(0).distance < 0.8 * pair.get(1).distance) {
        const m = pair.get(0);
        from.push(a.kp[m.queryIdx * 2], a.kp[m.queryIdx * 2 + 1]);
        to.push(f.kp[m.trainIdx * 2], f.kp[m.trainIdx * 2 + 1]);
      }
    }
    matches.delete();
    const found = fit(from, to, 4);
    return found && plausible(found.h, a.ref.box) ? found.h : null;
  };

  /**
   * Camera noise in a grey picture, as a standard deviation in grey levels (Immerkaer's method: the average size of
   * the picture's finest-scale roughness). Texture adds to it, which only makes the cut-off safer (higher).
   */
  const noiseSigma = (img: any) => {
    const kernel = cv.matFromArray(3, 3, cv.CV_32F, [1, -2, 1, -2, 4, -2, 1, -2, 1]);
    const rough = new cv.Mat();
    cv.filter2D(img, rough, cv.CV_32F, kernel);
    const d = rough.data32F as Float32Array;
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += Math.abs(d[i]);
    free(kernel, rough);
    return (Math.sqrt(Math.PI / 2) * sum) / (6 * Math.max(1, img.cols - 2) * Math.max(1, img.rows - 2));
  };

  /** Everything worked out once from an anchor picture: its corners, ORB features, and how it sits in the reference. */
  const prepare = (ref: AnchorRef) => {
    const img = toMat(ref.patch);
    const sx = (ref.box.w * W) / ref.patch.width, sy = (ref.box.h * H) / ref.patch.height;
    const P = [sx, 0, ref.box.x * W, 0, sy, ref.box.y * H, 0, 0, 1];

    const fill = (m: any, b: FracBox, value: number, pad: number) => {
      const x0 = Math.max(0, Math.floor(((b.x - ref.box.x) / ref.box.w) * img.cols) - pad);
      const y0 = Math.max(0, Math.floor(((b.y - ref.box.y) / ref.box.h) * img.rows) - pad);
      const x1 = Math.min(img.cols - 1, Math.ceil(((b.x + b.w - ref.box.x) / ref.box.w) * img.cols) + pad);
      const y1 = Math.min(img.rows - 1, Math.ceil(((b.y + b.h - ref.box.y) / ref.box.h) * img.rows) + pad);
      if (x1 >= x0 && y1 >= y0) cv.rectangle(m, new cv.Point(x0, y0), new cv.Point(x1, y1), new cv.Scalar(value), -1);
    };
    /** Where features may be found: only the drawing's own area when `useFocus`, and never the hand. */
    const maskFor = (focus: FracBox | null) => {
      if (!focus && !ref.exclude) return none;
      const m = new cv.Mat(img.rows, img.cols, cv.CV_8UC1, new cv.Scalar(focus ? 0 : 255));
      if (focus) fill(m, focus, 255, 0);
      if (ref.exclude) fill(m, ref.exclude, 0, 4);
      return m;
    };
    const strength = new cv.Mat();
    cv.cornerMinEigenVal(img, strength, 3, 3);
    const sigma = noiseSigma(img);
    const brightness = Math.min(1, cv.mean(img)[0] / DIM_BELOW);
    const floor = Math.min(
      MIN_CORNER_STRENGTH,
      Math.max(MIN_CORNER_STRENGTH_DIM, MIN_CORNER_STRENGTH * brightness * brightness, NOISE_MARGIN * NOISE_STRENGTH * sigma * sigma),
    );
    const findCorners = (mask: any) => {
      const kps = new cv.KeyPointVector();
      gftt.detect(img, kps, mask);
      const found: number[] = [];
      for (let i = 0; i < kps.size(); i++) {
        const { x, y } = kps.get(i).pt;
        const real = strength.floatAt(Math.round(y), Math.round(x)) >= floor; // not just camera grain
        if (real && x > 6 && y > 6 && x < ref.patch.width - 7 && y < ref.patch.height - 7) found.push(x, y);
      }
      free(kps);
      return found;
    };

    // The sent area can come from the other side of the call: use it only if it is a sane box.
    const f = ref.focus;
    const useFocus = !!f && [f.x, f.y, f.w, f.h].every((v) => Number.isFinite(v) && Math.abs(v) <= 8) && f.w > 0 && f.h > 0;
    const widened = (k: number): FracBox => ({ x: f!.x - (f!.w * (k - 1)) / 2, y: f!.y - (f!.h * (k - 1)) / 2, w: f!.w * k, h: f!.h * k });
    // Start with the drawing's own area; if it holds too little detail, widen it step by step (not straight to the
    // whole anchor, which may be mostly still background), and only then use everything.
    let mask: any = none, corners: number[] = [], focused: FracBox | null = null;
    for (const k of useFocus ? FOCUS_WIDEN : [0]) {
      if (mask !== none) mask.delete();
      focused = k ? widened(k) : null;
      mask = maskFor(focused);
      corners = findCorners(mask);
      if (!focused || corners.length / 2 >= FOCUS_MIN_CORNERS) break;
    }
    let roi: [number, number, number, number] = [0, 0, img.cols, img.rows];
    if (focused) {
      const x0 = Math.max(0, Math.floor(((focused.x - ref.box.x) / ref.box.w) * img.cols)), y0 = Math.max(0, Math.floor(((focused.y - ref.box.y) / ref.box.h) * img.rows));
      const x1 = Math.min(img.cols, Math.ceil(((focused.x + focused.w - ref.box.x) / ref.box.w) * img.cols)), y1 = Math.min(img.rows, Math.ceil(((focused.y + focused.h - ref.box.y) / ref.box.h) * img.rows));
      if (x1 - x0 >= 12 && y1 - y0 >= 12) roi = [x0, y0, x1 - x0, y1 - y0];
    }
    const okps = new cv.KeyPointVector();
    const desc = new cv.Mat();
    orbPatch.detectAndCompute(img, mask, okps, desc);
    const kp: number[] = [];
    for (let i = 0; i < okps.size(); i++) kp.push(...applyH(P, okps.get(i).pt.x, okps.get(i).pt.y));
    free(okps);
    if (mask !== none) mask.delete();
    strength.delete();
    return { img, roi, corners, P, kp, desc };
  };

  /** Nothing here can ever be found again (too dark, too plain): the drawing can only stay where it was drawn. */
  const untrackable = (a: Anchor) => a.corners.length / 2 < MIN_INLIERS; // `refine` gives up below this, whatever a search finds

  const lose = (a: Anchor) => {
    a.h = null;
    a.pts = [];
    a.refPts = [];
    a.tries = 0; // search on the very next picture
  };

  const add = (id: string, ref: AnchorRef, h: number[] | null) => {
    remove(id);
    const a: Anchor = { ref, ...prepare(ref), pts: [], refPts: [], h, last: h ?? IDENTITY.slice(), tries: 0 };
    anchors.set(id, a);
    return a;
  };

  const remove = (id: string) => {
    const a = anchors.get(id);
    if (a) free(a.img, a.desc);
    anchors.delete(id);
  };

  return {
    /** Feed the next picture. Returns where every drawing is now. `mask` hides an area (a hand) from tracking. */
    update(frame: Gray, mask: FracBox | null = null): Record<string, Placement> {
      if (frame.width !== W || frame.height !== H) {
        // New picture size: start over. Drawings are kept in fractions, so they survive and are searched for.
        prev?.delete();
        prev = null;
        W = frame.width;
        H = frame.height;
        for (const [id, a] of [...anchors]) lose(add(id, a.ref, null));
      }
      const cur = toMat(frame);
      predict(cur, mask);
      for (const a of anchors.values()) {
        if (a.h) {
          if (!refine(a, cur, mask, a.h)) lose(a);
        } else if (a.tries++ % SEARCH_EVERY === 0) {
          const found = locate(a, cur);
          if (found && !refine(a, cur, mask, found)) a.h = null;
        }
      }
      frameOrb?.desc.delete();
      frameOrb = null;
      prev?.delete();
      prev = cur;
      const out: Record<string, Placement> = {};
      for (const [id, a] of anchors) out[id] = { h: toFractions(a.h ?? a.last), state: a.h ? "locked" : untrackable(a) ? "fixed" : "searching" };
      return out;
    },

    /** Makes an anchor for a drawing on the last picture fed in. `around`: the drawing's area, in fractions. */
    addFromFrame(id: string, around: FracBox, exclude: FracBox | null = null): AnchorRef | null {
      if (!prev) return null;
      const box = anchorBox(around, W, H);
      const x0 = Math.round(box.x * W), y0 = Math.round(box.y * H);
      const w = Math.round(box.w * W), h = Math.round(box.h * H);
      const roi = prev.roi(new cv.Rect(x0, y0, w, h));
      const scale = Math.min(1, MAX_PATCH_SIDE / Math.max(w, h));
      const small = new cv.Mat();
      cv.resize(roi, small, new cv.Size(Math.round(w * scale), Math.round(h * scale)), 0, 0, cv.INTER_AREA);
      const ref: AnchorRef = {
        patch: { data: new Uint8Array(small.data), width: small.cols, height: small.rows },
        box: { x: x0 / W, y: y0 / H, w: w / W, h: h / H },
        ...(exclude && { exclude }),
        focus: focusOf(around),
      };
      free(roi, small);
      const a = add(id, ref, IDENTITY.slice());
      if (!refine(a, prev, null, IDENTITY)) a.h = IDENTITY.slice(); // too little detail: stays put until it can be found
      return ref;
    },

    /**
     * Re-makes an anchor to cover `around` (in its own reference terms), from the current picture
     * un-warped back to the reference view. Used when a drawing is finished: it started with a small
     * anchor and the camera may have moved meanwhile. The drawing's points stay as they are.
     */
    grow(id: string, around: FracBox, exclude: FracBox | null = null): AnchorRef | null {
      const old = anchors.get(id);
      if (!old || !prev) return null;
      const h = old.h ?? old.last;
      const box = anchorBox(around, W, H);
      const w = Math.round(box.w * W), hh = Math.round(box.h * H);
      const scale = Math.min(1, MAX_PATCH_SIDE / Math.max(w, hh));
      const pw = Math.round(w * scale), ph = Math.round(hh * scale);
      const P = [(box.w * W) / pw, 0, box.x * W, 0, (box.h * H) / ph, box.y * H, 0, 0, 1];
      const m = cv.matFromArray(3, 3, cv.CV_64F, mul(h, P));
      const patch = new cv.Mat();
      cv.warpPerspective(prev, patch, m, new cv.Size(pw, ph), cv.INTER_LINEAR | cv.WARP_INVERSE_MAP, cv.BORDER_REPLICATE);
      let referenceExclude: FracBox | undefined;
      if (exclude) {
        const inverse = invertH(h);
        const q = corners(exclude).map(([x, y]) => applyH(inverse, x, y));
        if (q.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) {
          const xs = q.map(([x]) => x / W), ys = q.map(([, y]) => y / H);
          referenceExclude = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        }
      }
      const ref: AnchorRef = { patch: { data: new Uint8Array(patch.data), width: pw, height: ph }, box, focus: focusOf(around), ...(referenceExclude && { exclude: referenceExclude }) };
      free(m, patch);
      const a = add(id, ref, h);
      if (!refine(a, prev, null, h)) a.h = h;
      return ref;
    },

    /** How much detail an anchor has to hold on to (corner points). Under about 20, tracking is weak. */
    detail(id: string) {
      return (anchors.get(id)?.corners.length ?? 0) / 2;
    },

    /** Adds an anchor made elsewhere (the other side of the call, or before a rejoin). It is searched for. */
    addRef(id: string, ref: AnchorRef) {
      if (W) add(id, ref, null);
      else anchors.set(id, { ref, img: new cv.Mat(), roi: [0, 0, 0, 0], corners: [], P: IDENTITY, kp: [], desc: new cv.Mat(), pts: [], refPts: [], h: null, last: IDENTITY.slice(), tries: 0 });
    },

    remove,

    clear() {
      for (const id of [...anchors.keys()]) remove(id);
    },
  };
}

export function applyH(h: number[], x: number, y: number): [number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export function mul(a: number[], b: number[]): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

export function invertH(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const inv = [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
  const det = a * inv[0] + b * inv[3] + c * inv[6];
  return inv.map((v) => v / det);
}

/** A drawing's own area with a small margin: where its anchor looks for features first. */
export function focusOf(around: FracBox): FracBox {
  const mx = Math.max(around.w * FOCUS_MARGIN, FOCUS_MIN_MARGIN), my = Math.max(around.h * FOCUS_MARGIN, FOCUS_MIN_MARGIN);
  return { x: around.x - mx, y: around.y - my, w: around.w + 2 * mx, h: around.h + 2 * my };
}

/** The area an anchor covers: the drawing's area with a margin, at least MIN_ANCHOR_SIDE, inside the picture. */
export function anchorBox(around: FracBox, W: number, H: number): FracBox {
  const short = Math.min(W, H);
  const w = Math.min(1, Math.max(around.w * 1.2, (MIN_ANCHOR_SIDE * short) / W));
  const h = Math.min(1, Math.max(around.h * 1.2, (MIN_ANCHOR_SIDE * short) / H));
  const cx = around.x + around.w / 2, cy = around.y + around.h / 2;
  return { x: Math.min(1 - w, Math.max(0, cx - w / 2)), y: Math.min(1 - h, Math.max(0, cy - h / 2)), w, h };
}
