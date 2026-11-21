// Makes the fake camera clips for the end-to-end test. Each is a grey textured panel (like a part with
// labels and rivets) with one blue dot on it. Chrome plays the clip as the camera
// (--use-file-for-fake-video-capture) and it loops seamlessly. The test boxes the blue dot and checks the
// box stays on it as it moves.
//
//   makeClip        the camera slides, turns and zooms over a still panel (the usual case: a phone moving)
//   makeObjectClip  the camera is still; a card carrying the dot slides and turns over the still panel
//                   (a book slid across a bench). The drawing must follow the card, not the bench.

import { createRequire } from "node:module";
import { openSync, writeSync, closeSync } from "node:fs";

export const CLIP = { width: 640, height: 360, fps: 30, frames: 120 };

const BLUE = [20, 40, 255]; // the dot (RGB)

/** A big panel of random grey shapes. */
function texture(cv, seed) {
  const world = new cv.Mat(900, 1600, cv.CV_8UC3, new cv.Scalar(128, 128, 128));
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * 1600, y = rnd() * 900, r = 3 + rnd() * 26, g = rnd() * 255;
    if (rnd() < 0.5) cv.circle(world, new cv.Point(x, y), r, new cv.Scalar(g, g, g), -1);
    else cv.rectangle(world, new cv.Point(x, y), new cv.Point(x + r * 2, y + r * 1.3), new cv.Scalar(g, g, g), -1);
  }
  return world;
}

/** Writes CLIP.frames pictures as a .y4m file; `draw(cv, f, frame)` fills the f-th picture. */
function writeClip(cv, path, draw) {
  const { width: W, height: H, frames } = CLIP;
  const fd = openSync(path, "w");
  writeSync(fd, `YUV4MPEG2 W${W} H${H} F${CLIP.fps}:1 Ip A1:1 C420jpeg\n`);
  const frame = new cv.Mat();
  const yuv = new cv.Mat();
  for (let f = 0; f < frames; f++) {
    draw(cv, f, frame);
    cv.cvtColor(frame, yuv, cv.COLOR_RGB2YUV_I420);
    writeSync(fd, "FRAME\n");
    writeSync(fd, yuv.data);
  }
  closeSync(fd);
  frame.delete();
  yuv.delete();
}

/** Panel centre to picture centre, then turn by `a`, zoom by `k` and slide by `dx`, `dy` (a 2x3 matrix). */
function placeAt(cv, W, H, a, k, dx, dy) {
  const c = Math.cos(a) * k * 0.4, sn = Math.sin(a) * k * 0.4;
  return cv.matFromArray(2, 3, cv.CV_64F, [c, -sn, W / 2 + dx - c * 800 + sn * 450, sn, c, H / 2 + dy - sn * 800 - c * 450]);
}

export async function makeClip(path) {
  const cv = await createRequire(import.meta.url)("@techstark/opencv-js");
  const { width: W, height: H, frames } = CLIP;
  const world = texture(cv, 7);
  cv.circle(world, new cv.Point(800, 450), 14, new cv.Scalar(...BLUE), -1);
  writeClip(cv, path, (cv, f, frame) => {
    const t = (f / frames) * 2 * Math.PI;
    const m = placeAt(cv, W, H, (10 * Math.PI / 180) * Math.sin(t), 1 + 0.1 * Math.sin(2 * t), 120 * Math.sin(t), 40 * Math.sin(2 * t));
    cv.warpAffine(world, frame, m, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(90, 90, 90));
    m.delete();
  });
  world.delete();
}

export async function makeObjectClip(path) {
  const cv = await createRequire(import.meta.url)("@techstark/opencv-js");
  const { width: W, height: H, frames } = CLIP;
  const bench = new cv.Mat();
  const panel = texture(cv, 7);
  cv.resize(panel, bench, new cv.Size(W, H), 0, 0, cv.INTER_AREA); // the still camera's view of the panel
  const card = texture(cv, 21); // the card has its own texture, with the dot in the middle
  cv.circle(card, new cv.Point(800, 450), 14, new cv.Scalar(...BLUE), -1);
  const cover = new cv.Mat(900, 1600, cv.CV_8UC1, new cv.Scalar(0)); // which part of `card` is the card
  // A small card (about 130 x 90 pixels in the picture): smaller than the area a drawing's anchor covers, so
  // the anchor holds mostly still panel. A tracker that follows the majority would stay with the panel.
  cv.rectangle(cover, new cv.Point(637, 338), new cv.Point(963, 563), new cv.Scalar(255), -1);
  const cardPicture = new cv.Mat(), cardCover = new cv.Mat();
  writeClip(cv, path, (cv, f, frame) => {
    const t = (f / frames) * 2 * Math.PI;
    const m = placeAt(cv, W, H, (10 * Math.PI / 180) * Math.sin(t), 1, 100 * Math.sin(t), 30 * Math.sin(2 * t));
    cv.warpAffine(card, cardPicture, m, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0));
    cv.warpAffine(cover, cardCover, m, new cv.Size(W, H), cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar(0));
    bench.copyTo(frame);
    cardPicture.copyTo(frame, cardCover);
    m.delete();
  });
  [bench, panel, card, cover, cardPicture, cardCover].forEach((x) => x.delete());
}
