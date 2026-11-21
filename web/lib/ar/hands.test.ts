// Hand gestures from finger positions: point, pinch to draw, open palm moved to rub out.
// Pass marks: docs/AR_CORE_PLAN.md §12.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHands, handConnections, isOpenHand, type HandEvent, type HandFrame } from "./hands.ts";

const FPS = 30;
const dt = 1000 / FPS;

/** A synthetic hand: index fingertip at `tip`, thumb tip `pinch` palm-widths away, palm `palm` wide. */
function hand(tip: [number, number], pinch: number, palm = 0.12, gesture = "None"): HandFrame {
  const [x, y] = tip;
  const p = Array.from({ length: 21 }, () => ({ x, y: y + palm, z: 0 }));
  p[0] = { x, y: y + palm * 2, z: 0 }; // wrist
  p[5] = { x: x - palm / 2, y: y + palm, z: 0 }; // index knuckle
  p[17] = { x: x + palm / 2, y: y + palm, z: 0 }; // little finger knuckle
  p[8] = { x, y, z: 0 }; // index tip
  p[4] = { x: x + pinch * palm, y, z: 0 }; // thumb tip
  return { landmarks: p, gesture, score: 0.9 };
}

function run(frames: (HandFrame | null)[]) {
  const h = createHands();
  const events: HandEvent[] = [];
  frames.forEach((f, i) => events.push(...h.update(f, i * dt, 1)));
  return events;
}
const count = (events: HandEvent[], type: HandEvent["type"]) => events.filter((e) => e.type === type).length;

test("hand outline connects each fingertip to the wrist and ignores incomplete landmarks", () => {
  const points = Array.from({ length: 21 }, (_, i) => ({ x: i / 21, y: i / 42, z: 0 }));
  const segments = handConnections(points);
  assert.equal(segments.length, 21);
  for (const tip of [4, 8, 12, 16, 20]) assert.ok(segments.some(([, b]) => b === points[tip]));
  assert.ok(segments.some(([a]) => a === points[0]));
  assert.deepEqual(handConnections(points.slice(0, 5)), []);
});
let seed = 3;
const noise = (amp: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 2 * amp;

test("a pinch draws one unbroken line, even when the fingers hover near the threshold", () => {
  const frames = [
    ...Array.from({ length: 10 }, (_, i) => hand([0.3 + i * 0.01, 0.5], 0.9)),
    ...Array.from({ length: 10 }, (_, i) => hand([0.4 + i * 0.01, 0.5], 0.2)),
    ...Array.from({ length: 30 }, (_, i) => hand([0.5 + i * 0.005, 0.5], 0.42 + noise(0.06))), // hovering
    ...Array.from({ length: 10 }, () => hand([0.65, 0.5], 1.0)),
  ];
  const events = run(frames);
  assert.equal(count(events, "draw-start"), 1);
  assert.equal(count(events, "draw-end"), 1);
  assert.ok(count(events, "draw-move") >= 35);
});

test("a one-picture blip neither starts nor ends a line", () => {
  const open = (n: number) => Array.from({ length: n }, () => hand([0.5, 0.5], 1));
  const pinch = (n: number) => Array.from({ length: n }, () => hand([0.5, 0.5], 0.2));
  assert.equal(count(run([...open(5), ...pinch(1), ...open(5)]), "draw-start"), 0, "blip of a pinch");
  assert.equal(count(run([...pinch(5), ...open(1), ...pinch(5)]), "draw-end"), 0, "blip of open fingers");
});

test("a pinch is judged against the size of the hand, near or far", () => {
  for (const palm of [0.04, 0.3]) {
    assert.equal(count(run(Array.from({ length: 15 }, () => hand([0.5, 0.5], 1.2, palm))), "draw-start"), 0, `open, palm ${palm}`);
    assert.equal(count(run(Array.from({ length: 15 }, () => hand([0.5, 0.5], 0.15, palm))), "draw-start"), 1, `pinched, palm ${palm}`);
  }
});

test("a still fingertip's jitter is cut by at least 60%", () => {
  const raw: number[] = [];
  const out: number[] = [];
  const h = createHands();
  for (let i = 0; i < 120; i++) {
    const x = 0.5 + noise(0.006);
    raw.push(x);
    const p = h.update(hand([x, 0.5], 1), i * dt, 1).find((e) => e.type === "point");
    if (p && p.type === "point" && i > 20) out.push(p.at[0]);
  }
  const sd = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + (x - 0.5) ** 2, 0) / v.length);
  const ratio = sd(out) / sd(raw.slice(21));
  assert.ok(ratio <= 0.4, `jitter kept: ${(ratio * 100).toFixed(0)}%`);
});

test("a moving fingertip lags less than 2 frames", () => {
  const speed = 0.6 / FPS; // 60% of the picture a second
  const h = createHands();
  let lagFrames = 0;
  for (let i = 0; i < 40; i++) {
    const x = 0.1 + i * speed;
    const p = h.update(hand([x, 0.5], 1), i * dt, 1).find((e) => e.type === "point");
    if (p && p.type === "point" && i >= 20) lagFrames = Math.max(lagFrames, (x - p.at[0]) / speed);
  }
  assert.ok(lagFrames < 2, `lag ${lagFrames.toFixed(2)} frames`);
});

const palm = (x: number, y = 0.5, gesture = "Open_Palm") => hand([x, y], 1.5, 0.12, gesture);
const sweep = (n: number, from = 0.3) => Array.from({ length: n }, (_, i) => palm(from + i * 0.01));

test("an open palm that moves rubs at once, with no hold", () => {
  const events = run([...sweep(10), palm(0.5, 0.5, "None"), palm(0.5, 0.5, "None"), palm(0.5, 0.5, "None"), palm(0.5, 0.5, "None")]);
  assert.equal(count(events, "erase-ready"), 1);
  assert.ok(count(events, "erase-move") >= 5, "rubs while the palm moves");
  assert.equal(count(events, "erase-end"), 1, "closing the hand ends the rub");
  const first = events.findIndex((e) => e.type === "erase-move");
  assert.ok(first < 6 * 3, "rubbing starts within a few pictures"); // 3 events a picture at most
});

test("a still open palm never erases", () => {
  assert.ok(!run(Array.from({ length: 120 }, () => palm(0.5))).some((e) => e.type === "erase-ready" || e.type === "erase-move"));
});

test("one misread palm picture neither starts nor ends a rub", () => {
  const moving = (n: number, from: number, gesture = "None") => Array.from({ length: n }, (_, i) => palm(from + i * 0.01, 0.5, gesture));
  assert.equal(count(run([...moving(6, 0.3), ...moving(1, 0.36, "Open_Palm"), ...moving(6, 0.37)]), "erase-ready"), 0, "one palm picture");
  const events = run([...sweep(8), ...moving(1, 0.38), ...sweep(8, 0.39)]);
  assert.equal(count(events, "erase-ready"), 1);
  assert.equal(count(events, "erase-end"), 0, "one missed picture does not end the rub");
});

test("an open palm does not rub while pinching", () => {
  const pinching = Array.from({ length: 12 }, (_, i) => hand([0.3 + i * 0.01, 0.5], 0.1, 0.12, "Open_Palm"));
  assert.equal(count(run(pinching), "erase-move"), 0);
});

test("a hand result that comes at 10 a second keeps the line unbroken through one missed picture", () => {
  const h = createHands();
  const events: HandEvent[] = [];
  const frames = [
    ...Array.from({ length: 4 }, () => hand([0.5, 0.5], 0.9)),
    ...Array.from({ length: 4 }, (_, i) => hand([0.5 + i * 0.01, 0.5], 0.2)),
    null, // one missed picture, 100 ms after the last
    ...Array.from({ length: 4 }, (_, i) => hand([0.55 + i * 0.01, 0.5], 0.2)),
    ...Array.from({ length: 4 }, () => null),
  ];
  frames.forEach((f, i) => events.push(...h.update(f, i * 100, 1)));
  assert.equal(count(events, "draw-start"), 1);
  assert.equal(count(events, "draw-end"), 1);
  assert.ok(count(events, "draw-move") >= 6);
});

test("a line ends when the hand leaves the picture", () => {
  const events = run([...Array.from({ length: 6 }, () => hand([0.5, 0.5], 0.1)), null, null, null, null]);
  assert.equal(count(events, "draw-start"), 1);
  assert.equal(count(events, "draw-end"), 1);
  assert.equal(events[events.length - 1].type, "gone");
});

// ---- an open hand, worked out from the finger joints themselves ----

/** A hand seen from the front: wrist at the bottom, four fingers pointing up (`reach` 1) or curled in (`reach` 0). */
function fingers(x: number, y: number, reach: number, which = [0, 1, 2, 3]) {
  const p = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  p[0] = { x, y: y + 0.2, z: 0 }; // wrist
  [5, 9, 13, 17].forEach((knuckle, f) => {
    const dx = x - 0.06 + f * 0.04;
    const out = which.includes(f) ? reach : 0;
    p[knuckle] = { x: dx, y: y + 0.02, z: 0 }; // knuckle
    p[knuckle + 1] = { x: dx, y: y + 0.02 - 0.08 * out, z: 0 }; // middle joint
    p[knuckle + 2] = { x: dx, y: y + 0.02 - 0.12 * out, z: 0 };
    p[knuckle + 3] = { x: dx, y: y + 0.02 - 0.2 * out, z: 0 }; // fingertip: far from the wrist only when the finger is out
  });
  return p;
}

test("an open hand is told from a fist, a pointing finger and a curled hand, by the finger joints", () => {
  assert.equal(isOpenHand(fingers(0.5, 0.4, 1)), true);
  assert.equal(isOpenHand(fingers(0.5, 0.4, 0)), false, "fist");
  assert.equal(isOpenHand(fingers(0.5, 0.4, 1, [0])), false, "pointing");
  assert.equal(isOpenHand(fingers(0.5, 0.4, 1, [0, 1])), false, "two fingers");
  assert.equal(isOpenHand(fingers(0.5, 0.4, 0.1)), false, "nearly closed");
});

test("an open hand rubs even when the classifier calls it nothing; a fist does not", () => {
  const moving = (reach: number) => Array.from({ length: 12 }, (_, i) => ({ landmarks: fingers(0.3 + i * 0.01, 0.4, reach), gesture: "None", score: 0.9 } as HandFrame));
  assert.ok(count(run(moving(1)), "erase-move") >= 5, "open hand rubs");
  assert.equal(count(run(moving(0)), "erase-move"), 0, "a fist does not");
});
