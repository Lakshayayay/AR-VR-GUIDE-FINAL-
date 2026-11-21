// Tracker accuracy, measured against a synthetic textured panel filmed by a virtual camera.
// The camera's motion is known exactly, so the true position of every anchor is known.
// Run: npm test (from web/).   Pass marks are in docs/history/AR_CORE_PLAN.md §12 (pixels at 480 wide).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createTracker, ANALYSIS_LONG_SIDE, type AnchorRef, type FracBox, type Gray } from "./anchor-core.ts";

const cv = await createRequire(import.meta.url)("@techstark/opencv-js");

const FW = ANALYSIS_LONG_SIDE;
const FH = Math.round((FW * 9) / 16);
const TO_480 = 480 / FW; // pass marks are stated for a 480-wide picture

/** A large panel of random shapes (like labels, bolts, rivets, scratches). */
function panel(seed: number) {
  const W = 1600, H = 900;
  const m = new cv.Mat(H, W, cv.CV_8UC1, new cv.Scalar(128));
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * W, y = rnd() * H, r = 3 + rnd() * 26, g = rnd() * 255;
    if (rnd() < 0.5) cv.circle(m, new cv.Point(x, y), r, new cv.Scalar(g), -1);
    else cv.rectangle(m, new cv.Point(x, y), new cv.Point(x + r * 2, y + r * 1.3), new cv.Scalar(g), -1);
  }
  cv.GaussianBlur(m, m, new cv.Size(3, 3), 0);
  return m;
}

type M3 = number[];
const mul = (a: M3, b: M3): M3 => {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
};
const apply = (h: M3, x: number, y: number): [number, number] => {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
};
const cx = FW / 2, cy = FH / 2;
const about = (m: M3): M3 => mul(mul([1, 0, cx, 0, 1, cy, 0, 0, 1], m), [1, 0, -cx, 0, 1, -cy, 0, 0, 1]);
const slide = (dx: number, dy: number): M3 => [1, 0, dx, 0, 1, dy, 0, 0, 1];
const zoom = (s: number): M3 => about([s, 0, 0, 0, s, 0, 0, 0, 1]);
const turn = (deg: number): M3 => {
  const a = (deg * Math.PI) / 180;
  return about([Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1]);
};
/** Seeing the part from `deg` further to the side (perspective change), kept in the middle of the picture. */
const tilt = (deg: number): M3 => {
  const a = (deg * Math.PI) / 180, f = FW * 0.9;
  const K = [f, 0, cx, 0, f, cy, 0, 0, 1], Ki = [1 / f, 0, -cx / f, 0, 1 / f, -cy / f, 0, 0, 1];
  const m = mul(mul(K, [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)]), Ki);
  const [mx, my] = apply(m, cx, cy);
  return mul(slide(cx - mx, cy - my), m);
};

// Camera grain: every picture gets its own random noise of up to ±GRAIN grey levels, like a real sensor.
const GRAIN = 12;
let grainSeed = 1;
const grain = () => (grainSeed = (grainSeed * 1103515245 + 12345) % 2147483648) / 2147483648;

// Base camera: sees the middle of the panel. Motions are applied in picture space on top of it.
const BASE = mul([FW / 800, 0, 0, 0, FW / 800, 0, 0, 0, 1], [1, 0, -400, 0, 1, -225, 0, 0, 1]);

function film(world: any, motion: M3, block?: { x: number; y: number; w: number; h: number }): Gray {
  const out = new cv.Mat();
  const g = cv.matFromArray(3, 3, cv.CV_64F, mul(motion, BASE));
  cv.warpPerspective(world, out, g, new cv.Size(FW, FH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(90));
  if (block) cv.rectangle(out, new cv.Point(block.x, block.y), new cv.Point(block.x + block.w, block.y + block.h), new cv.Scalar(0), -1);
  const gray = { data: new Uint8Array(out.data), width: FW, height: FH };
  for (let i = 0; i < gray.data.length; i++) gray.data[i] = Math.max(0, Math.min(255, gray.data[i] + (grain() - 0.5) * 2 * GRAIN));
  g.delete();
  out.delete();
  return gray;
}

/** Error of an estimated placement (fractions -> fractions) against the true motion, in pixels at 480 wide. */
function error(h: number[], truth: M3, box: FracBox) {
  const pts = [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]].map(([u, v]) => [box.x + u * box.w, box.y + v * box.h]);
  const errs = pts.map(([x, y]) => {
    const [ex, ey] = apply(h, x, y);
    const [tx, ty] = apply(truth, x * FW, y * FH);
    return Math.hypot(ex * FW - tx, ey * FH - ty) * TO_480;
  });
  return { mean: errs.reduce((a, b) => a + b, 0) / errs.length, worst: Math.max(...errs) };
}

const world = panel(7);
const BOX: FracBox = { x: 0.4, y: 0.35, w: 0.2, h: 0.3 };

test("an anchor excludes a hand-covered region when it detects features", () => {
  const t = createTracker(cv);
  t.update(film(world, slide(0, 0)));
  const hand = { x: 0, y: 0, w: 1, h: 1 };
  const ref = t.addFromFrame("covered", BOX, hand);
  assert.ok(ref);
  assert.deepEqual(ref.exclude, hand);
  assert.equal(t.detail("covered"), 0, "the hand must not become the surface anchor");
});

test("an anchor with a masked hand can still be found on the other screen", () => {
  const local = createTracker(cv);
  local.update(film(world, slide(0, 0)));
  const ref = local.addFromFrame("a", BOX, { x: 0.47, y: 0.39, w: 0.06, h: 0.15 });
  assert.ok(ref);
  const remote = createTracker(cv);
  remote.addRef("a", ref);
  const motion = slide(20, -10);
  const placed = remote.update(film(world, motion)).a;
  assert.equal(placed.state, "locked");
  assert.ok(error(placed.h, motion, BOX).worst <= 5);
});

/** Anchor made on the first picture, then sent to a fresh tracker (like the other side of the call). */
function sentAnchor(): AnchorRef {
  const local = createTracker(cv);
  local.update(film(world, slide(0, 0)));
  const ref = local.addFromFrame("a", BOX);
  assert.ok(ref, "anchor was made");
  return ref;
}

for (const [name, motion] of [
  ["slide", slide(70, -35)],
  ["2x zoom", zoom(2)],
  ["30° turn", turn(30)],
  ["30° tilt", tilt(30)],
] as const) {
  test(`the other side finds a drawing after a ${name}`, () => {
    const remote = createTracker(cv);
    remote.addRef("a", sentAnchor());
    const placed = remote.update(film(world, motion)).a;
    assert.equal(placed.state, "locked");
    const e = error(placed.h, motion, BOX);
    assert.ok(e.mean <= 2 && e.worst <= 5, `${name}: mean ${e.mean.toFixed(2)} px, worst ${e.worst.toFixed(2)} px`);
  });
}

/** Moves the camera from still to `end` over n pictures and checks every picture. */
function followMotion(end: (t: number) => M3, n: number, block?: (t: number) => { x: number; y: number; w: number; h: number }) {
  const t0 = createTracker(cv);
  t0.update(film(world, slide(0, 0)));
  t0.addFromFrame("a", BOX);
  let worstMean = 0, worst = 0, ms = 0;
  for (let i = 1; i <= n; i++) {
    const m = end(i / n);
    const frame = film(world, m, block?.(i / n));
    const start = performance.now();
    const placed = t0.update(frame).a;
    ms += performance.now() - start;
    assert.equal(placed.state, "locked", `picture ${i} lost the drawing`);
    const e = error(placed.h, m, BOX);
    worstMean = Math.max(worstMean, e.mean);
    worst = Math.max(worst, e.worst);
  }
  return { worstMean, worst, msPerPicture: ms / n };
}

test("a drawing follows the part while the camera moves, zooms, turns and tilts", () => {
  const r = followMotion((t) => mul(mul(slide(50 * t, 20 * t), zoom(1 + 0.6 * t)), mul(turn(25 * t), tilt(20 * t))), 45);
  console.log(`  follow: worst mean ${r.worstMean.toFixed(2)} px, worst ${r.worst.toFixed(2)} px, ${r.msPerPicture.toFixed(1)} ms a picture`);
  assert.ok(r.worstMean <= 2 && r.worst <= 5, JSON.stringify(r));
});

test("five separate drawings remain locked as the synthetic camera moves", () => {
  const t = createTracker(cv);
  t.update(film(world, slide(0, 0)));
  const boxes = Array.from({ length: 5 }, (_, i) => ({ x: 0.2 + i * 0.12, y: 0.35, w: 0.08, h: 0.2 }));
  boxes.forEach((box, i) => t.addFromFrame(`mark-${i}`, box));
  let elapsed = 0;
  for (let i = 1; i <= 30; i++) {
    const motion = mul(slide(i, i / 3), turn(i / 6));
    const frame = film(world, motion);
    const start = performance.now();
    const placed = t.update(frame);
    elapsed += performance.now() - start;
    boxes.forEach((box, j) => {
      const mark = placed[`mark-${j}`];
      assert.equal(mark.state, "locked");
      assert.ok(error(mark.h, motion, box).worst <= 5);
    });
  }
  console.log(`  five synthetic anchors: ${(1000 * 30 / elapsed).toFixed(1)} tracker updates/s on this computer`);
});

test("a drawing stays put while a hand covers a quarter of it", () => {
  const bw = BOX.w * FW * 0.5, bh = BOX.h * FH * 0.5; // a quarter of the area
  const r = followMotion(
    (t) => slide(40 * t, 15 * t),
    40,
    (t) => ({ x: BOX.x * FW - bw + t * (BOX.w * FW + bw), y: (BOX.y + BOX.h / 4) * FH + 15 * t, w: bw, h: bh }),
  );
  assert.ok(r.worstMean <= 2 && r.worst <= 5, JSON.stringify(r));
});

test("a drawing comes back when the part is seen again", () => {
  const t0 = createTracker(cv);
  t0.update(film(world, slide(0, 0)));
  t0.addFromFrame("a", BOX);
  const elsewhere = panel(99);
  let state = "locked";
  for (let i = 0; i < 15; i++) state = t0.update(film(elsewhere, slide(0, 0))).a.state;
  assert.equal(state, "searching", "knows the part is out of view");

  const back = slide(-60, 30);
  let found = -1;
  for (let i = 1; i <= 15 && found < 0; i++) if (t0.update(film(world, back)).a.state === "locked") found = i;
  assert.ok(found > 0, "found again within 15 pictures");
  const e = error(t0.update(film(world, back)).a.h, back, BOX);
  assert.ok(e.mean <= 2 && e.worst <= 5, `after coming back: mean ${e.mean.toFixed(2)}, worst ${e.worst.toFixed(2)}`);
});

test("an anchor grown after the camera moved still puts the drawing on the right spot for the other side", () => {
  // Drawing starts on picture 0 with a small anchor, the camera moves while drawing, then the anchor
  // is grown to the drawing's full area (in picture-0 terms) and sent.
  const local = createTracker(cv);
  local.update(film(world, slide(0, 0)));
  local.addFromFrame("a", { x: 0.45, y: 0.45, w: 0.02, h: 0.02 });
  for (let i = 1; i <= 10; i++) local.update(film(world, mul(slide(4 * i, 2 * i), turn(i))));
  const ref = local.grow("a", BOX);
  assert.ok(ref, "anchor was grown");
  assert.ok(Math.abs(ref.box.x + ref.box.w / 2 - 0.5) < 0.01 && ref.box.w >= BOX.w, "grown around the drawing, in picture-0 terms");

  const remote = createTracker(cv);
  remote.addRef("a", ref);
  const motion = mul(slide(-30, 20), zoom(1.3));
  const placed = remote.update(film(world, motion)).a;
  assert.equal(placed.state, "locked");
  const e = error(placed.h, motion, BOX);
  assert.ok(e.mean <= 2 && e.worst <= 5, `mean ${e.mean.toFixed(2)} px, worst ${e.worst.toFixed(2)} px`);
});

test("a featureless area is reported as having little detail", () => {
  const local = createTracker(cv);
  const plain = new cv.Mat(900, 1600, cv.CV_8UC1, new cv.Scalar(140));
  local.update(film(plain, slide(0, 0)));
  local.addFromFrame("a", BOX);
  assert.ok(local.detail("a") < 20, `detail ${local.detail("a")}`);
  local.update(film(world, slide(0, 0)));
  local.addFromFrame("b", BOX);
  assert.ok(local.detail("b") >= 60, `detail ${local.detail("b")}`);
});

test("removed drawings are no longer tracked", () => {
  const t0 = createTracker(cv);
  t0.update(film(world, slide(0, 0)));
  t0.addFromFrame("a", BOX);
  t0.addFromFrame("b", { x: 0.1, y: 0.1, w: 0.1, h: 0.1 });
  t0.remove("a");
  assert.deepEqual(Object.keys(t0.update(film(world, slide(5, 0)))), ["b"]);
  t0.clear();
  assert.deepEqual(t0.update(film(world, slide(5, 0))), {});
});

// ---- the camera stays still and an object moves (a book slid across a bench) ----

const card = panel(21); // the object's own texture
const CARD = { x: 100, y: 100 }; // where the card is cut from `card`, in its own pixels
const cardMask = (() => {
  const m = new cv.Mat(card.rows, card.cols, cv.CV_8UC1, new cv.Scalar(0));
  cv.rectangle(m, new cv.Point(CARD.x, CARD.y), new cv.Point(CARD.x + BOX.w * FW, CARD.y + BOX.h * FH), new cv.Scalar(255), -1);
  return m;
})();
const onBox = mul([1, 0, BOX.x * FW - CARD.x, 0, 1, BOX.y * FH - CARD.y, 0, 0, 1], [1, 0, 0, 0, 1, 0, 0, 0, 1]); // card pixels -> picture, at rest
const boxCentre = [(BOX.x + BOX.w / 2) * FW, (BOX.y + BOX.h / 2) * FH];
/** The card's motion: slides by `dx`, `dy` pixels and turns `deg` degrees about its own centre. */
const cardMotion = (dx: number, dy: number, deg: number): M3 => {
  const a = (deg * Math.PI) / 180, [x, y] = boxCentre;
  const turnAbout = [Math.cos(a), -Math.sin(a), x - Math.cos(a) * x + Math.sin(a) * y, Math.sin(a), Math.cos(a), y - Math.sin(a) * x - Math.cos(a) * y, 0, 0, 1];
  return mul(slide(dx, dy), turnAbout);
};

/** The still bench (the panel) with the card lying on `BOX`, moved by `motion` (null: no card). */
function filmWithCard(motion: M3 | null): Gray {
  const out = new cv.Mat();
  const bench = cv.matFromArray(3, 3, cv.CV_64F, BASE);
  cv.warpPerspective(world, out, bench, new cv.Size(FW, FH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(90));
  if (motion) {
    const to = cv.matFromArray(3, 3, cv.CV_64F, mul(motion, onBox));
    const pic = new cv.Mat(), cover = new cv.Mat();
    cv.warpPerspective(card, pic, to, new cv.Size(FW, FH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0));
    cv.warpPerspective(cardMask, cover, to, new cv.Size(FW, FH), cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar(0));
    pic.copyTo(out, cover);
    to.delete(); pic.delete(); cover.delete();
  }
  const gray = { data: new Uint8Array(out.data), width: FW, height: FH };
  for (let i = 0; i < gray.data.length; i++) gray.data[i] = Math.max(0, Math.min(255, gray.data[i] + (grain() - 0.5) * 2 * GRAIN));
  bench.delete();
  out.delete();
  return gray;
}

test("a drawing follows an object that moves while the camera is still", () => {
  const t = createTracker(cv);
  t.update(filmWithCard(cardMotion(0, 0, 0)));
  t.addFromFrame("a", BOX); // drawn round the card; the anchor area is bigger than the card, so it also holds bench
  let worstMean = 0, worst = 0;
  for (let i = 1; i <= 30; i++) {
    const m = cardMotion(2 * i, i, i / 2); // 60 px right, 30 down, 15° turn
    const placed = t.update(filmWithCard(m)).a;
    assert.equal(placed.state, "locked", `picture ${i} lost the drawing`);
    const e = error(placed.h, m, BOX);
    worstMean = Math.max(worstMean, e.mean);
    worst = Math.max(worst, e.worst);
  }
  assert.ok(worstMean <= 2 && worst <= 5, `object follow: worst mean ${worstMean.toFixed(2)} px, worst ${worst.toFixed(2)} px`);
});

test("a drawing on the bench stays put while an object moves beside it", () => {
  const near: FracBox = { x: 0.14, y: 0.35, w: 0.2, h: 0.3 };
  const t = createTracker(cv);
  t.update(filmWithCard(cardMotion(0, 0, 0)));
  t.addFromFrame("a", near);
  let worst = 0;
  for (let i = 1; i <= 30; i++) {
    const placed = t.update(filmWithCard(cardMotion(-2 * i, i / 2, 0))).a; // the card slides towards the drawing
    assert.equal(placed.state, "locked", `picture ${i} lost the drawing`);
    worst = Math.max(worst, error(placed.h, slide(0, 0), near).worst);
  }
  assert.ok(worst <= 2, `the drawing on the bench moved ${worst.toFixed(2)} px`);
});

test("after a small object jumped (freeze, then resume) the drawing is found on it again, never reported found in the wrong place", () => {
  const small: FracBox = { x: 0.455, y: 0.42, w: 0.09, h: 0.16 }; // a mark on the middle of the card
  const t = createTracker(cv);
  t.update(filmWithCard(cardMotion(0, 0, 0)));
  t.addFromFrame("a", small);
  // Paused, the card is moved 70 px and turned 8°; the next pictures show it there.
  const jump = cardMotion(70, 25, 8);
  let confidentlyWrong = 0, foundAt = -1;
  for (let i = 1; i <= 20; i++) {
    const placed = t.update(filmWithCard(jump)).a;
    const wrong = error(placed.h, jump, small).worst > 5;
    if (placed.state === "locked" && wrong) confidentlyWrong++;
    if (placed.state === "locked" && !wrong && foundAt < 0) foundAt = i;
  }
  assert.equal(confidentlyWrong, 0, `reported "locked" in the wrong place on ${confidentlyWrong} of 20 pictures (found correctly at picture ${foundAt})`);
  assert.ok(foundAt > 0 && foundAt <= 10, `found again on the card at picture ${foundAt} (wanted within 10)`);
});

// ---- a dark room (the owner's webcam frame: average brightness 31 of 255, real edges very faint) ----

/** The panel, darker (`gain` times as bright, so every edge is `gain` times as strong), with camera grain of ±`grainAmp`. */
function filmDim(motion: M3, gain: number, grainAmp: number): Gray {
  const out = new cv.Mat(), dark = new cv.Mat();
  const g = cv.matFromArray(3, 3, cv.CV_64F, mul(motion, BASE));
  cv.warpPerspective(world, out, g, new cv.Size(FW, FH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(90));
  out.convertTo(dark, -1, gain, 0);
  const gray = { data: new Uint8Array(dark.data), width: FW, height: FH };
  for (let i = 0; i < gray.data.length; i++) gray.data[i] = Math.max(0, Math.min(255, gray.data[i] + (grain() - 0.5) * 2 * grainAmp));
  g.delete(); out.delete(); dark.delete();
  return gray;
}

test("a drawing in a dim room still gets enough points to follow the part", () => {
  const t = createTracker(cv);
  t.update(filmDim(slide(0, 0), 0.2, 2)); // very dark (edges a fifth as strong), little grain
  t.addFromFrame("a", BOX);
  assert.ok(t.detail("a") >= 40, `dim room: only ${t.detail("a")} points`);
  let worst = 0;
  for (let i = 1; i <= 20; i++) {
    const m = slide(2 * i, i);
    const placed = t.update(filmDim(m, 0.2, 2)).a;
    assert.equal(placed.state, "locked", `picture ${i} lost the drawing`);
    worst = Math.max(worst, error(placed.h, m, BOX).worst);
  }
  assert.ok(worst <= 5, `dim room: worst error ${worst.toFixed(1)} px`);
});

test("camera grain alone, even in a dim room, is never taken for detail", () => {
  const plain = new cv.Mat(900, 1600, cv.CV_8UC1, new cv.Scalar(140));
  for (const [gain, grainAmp] of [[1, 12], [0.25, 6], [0.2, 2]] as const) {
    const t = createTracker(cv);
    const frame = filmDim(slide(0, 0), gain, grainAmp);
    // film a blank wall: overwrite the panel with the plain one
    const wall = new cv.Mat();
    plain.convertTo(wall, -1, gain, 0);
    const data = new Uint8Array(FW * FH);
    for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, wall.data[i % wall.data.length] + (grain() - 0.5) * 2 * grainAmp));
    t.update({ data, width: FW, height: FH });
    t.addFromFrame("a", BOX);
    assert.ok(t.detail("a") < 20, `blank wall, brightness ${gain}, grain ±${grainAmp}: ${t.detail("a")} points`);
    wall.delete();
    void frame;
  }
});

test("a drawing on a surface with nothing to hold on to is reported as fixed to the screen, not as lost", () => {
  const plain = new cv.Mat(900, 1600, cv.CV_8UC1, new cv.Scalar(140));
  const t = createTracker(cv);
  t.update(film(plain, slide(0, 0)));
  t.addFromFrame("a", BOX);
  let state = "";
  for (let i = 0; i < 5; i++) state = t.update(film(plain, slide(0, 0))).a.state;
  assert.equal(state, "fixed");
});
