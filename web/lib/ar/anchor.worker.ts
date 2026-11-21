// Background worker: runs the anchor tracker (lib/ar/anchor-core.ts) off the main thread, so drawing
// and video stay smooth. OpenCV is loaded from our own server (public/vendor), never from the internet.
// Messages are handled strictly in order. See lib/ar/use-anchors.ts for the other end.

import { createTracker, type FracBox, type Gray } from "./anchor-core";

export type ToWorker =
  | { type: "frame"; bitmap: ImageBitmap; mask: FracBox | null }
  | { type: "begin"; id: string; x: number; y: number }
  | { type: "finish"; id: string; around: FracBox }
  | { type: "add"; id: string; img: string; box: FracBox; exclude?: FracBox; focus?: FracBox }
  | { type: "remove"; id: string }
  | { type: "clear" };

export type FromWorker =
  | { type: "ready" }
  | { type: "failed"; error: string }
  | { type: "placed"; placements: Record<string, { h: number[]; state: "locked" | "fixed" | "searching" }>; ms: number }
  | { type: "anchored"; id: string; anchor: { img: string; box: FracBox; exclude?: FracBox; focus?: FracBox } | null; detail: number };

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

let tracker: ReturnType<typeof createTracker> | null = null;
let last: Record<string, { h: number[]; state: "locked" | "fixed" | "searching" }> = {};
let lastMask: FracBox | null = null;
const loaded: Promise<void> = (async () => {
  (self as any).importScripts("/vendor/opencv/opencv.js"); // sets self.cv to a promise of the module
  tracker = createTracker(await (self as any).cv);
})();

const scratch = new OffscreenCanvas(1, 1);
const sctx = scratch.getContext("2d", { willReadFrequently: true })!;

function grayOf(bitmap: ImageBitmap): Gray {
  const { width, height } = bitmap;
  if (scratch.width !== width || scratch.height !== height) Object.assign(scratch, { width, height });
  sctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = sctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return { data, width, height };
}

async function toJpeg(g: Gray): Promise<string> {
  const c = new OffscreenCanvas(g.width, g.height);
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(g.width, g.height);
  for (let i = 0; i < g.data.length; i++) img.data.set([g.data[i], g.data[i], g.data[i], 255], i * 4);
  ctx.putImageData(img, 0, 0);
  let url = "";
  for (const quality of [0.85, 0.6, 0.4]) {
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg", quality })).arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    url = `data:image/jpeg;base64,${btoa(s)}`;
    if (url.length <= MAX_ANCHOR_CHARS) break;
  }
  return url;
}

/** Same limit as the server (backend/app/realtime.py MAX_ANCHOR_CHARS). */
const MAX_ANCHOR_CHARS = 40_000;

async function fromJpeg(url: string): Promise<Gray> {
  return grayOf(await createImageBitmap(await (await fetch(url)).blob()));
}

async function handle(m: ToWorker) {
  await loaded;
  const t = tracker!;
  if (m.type === "frame") {
    const start = performance.now();
    lastMask = m.mask;
    last = t.update(grayOf(m.bitmap), m.mask);
    post({ type: "placed", placements: last, ms: performance.now() - start });
  } else if (m.type === "begin") {
    t.addFromFrame(m.id, { x: m.x - 0.01, y: m.y - 0.01, w: 0.02, h: 0.02 }, lastMask);
  } else if (m.type === "finish") {
    const ref = t.grow(m.id, m.around, lastMask);
    post({ type: "anchored", id: m.id, anchor: ref && { img: await toJpeg(ref.patch), box: ref.box, ...(ref.exclude && { exclude: ref.exclude }), ...(ref.focus && { focus: ref.focus }) }, detail: t.detail(m.id) });
  } else if (m.type === "add") {
    t.addRef(m.id, { patch: await fromJpeg(m.img), box: m.box, ...(m.exclude && { exclude: m.exclude }), ...(m.focus && { focus: m.focus }) });
  } else if (m.type === "remove") {
    t.remove(m.id);
  } else if (m.type === "clear") {
    t.clear();
  }
}

let chain = loaded.then(() => post({ type: "ready" }), (e) => post({ type: "failed", error: String(e) }));
self.onmessage = (e: MessageEvent<ToWorker>) => {
  chain = chain.then(() => handle(e.data)).catch((err) => {
    if (e.data.type === "frame") post({ type: "placed", placements: last, ms: 0 }); // keep the picture flowing
    console.warn("AR worker:", err);
  });
};
