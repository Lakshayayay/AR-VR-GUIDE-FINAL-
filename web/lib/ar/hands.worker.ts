// Background worker: MediaPipe's hand recogniser, kept off the main thread so a slow phone (or a slow
// first picture) can never freeze the video or the drawings. Model and runtime come from our own
// public/vendor folder. Gestures are worked out on the main thread (lib/ar/hands.ts).

import { FilesetResolver, GestureRecognizer } from "@mediapipe/tasks-vision";
import type { HandFrame } from "./hands";

export type ToHandsWorker = { bitmap: ImageBitmap; ms: number };
export type FromHandsWorker =
  | { type: "ready" }
  | { type: "failed"; error: string }
  | { type: "hand"; hand: HandFrame | null; ms: number };

const post = (m: FromHandsWorker) => (self as unknown as Worker).postMessage(m);

// ponytail: CPU only. Try the GPU (MediaPipe can draw to an OffscreenCanvas here) if hands lag on the owner's phone.
let recognizer: GestureRecognizer | null = null;
const loaded = (async () => {
  const files = await FilesetResolver.forVisionTasks("/vendor/mediapipe/wasm");
  recognizer = await GestureRecognizer.createFromOptions(files, {
    baseOptions: { modelAssetPath: "/vendor/mediapipe/gesture_recognizer.task", delegate: "CPU" },
    runningMode: "VIDEO",
    numHands: 1,
  });
})();
loaded.then(() => post({ type: "ready" }), (e) => post({ type: "failed", error: String(e) }));

self.onmessage = async (e: MessageEvent<ToHandsWorker>) => {
  const { bitmap, ms } = e.data;
  await loaded.catch(() => {});
  let hand: HandFrame | null = null;
  try {
    const r = recognizer?.recognizeForVideo(bitmap, ms);
    const g = r?.gestures[0]?.[0];
    if (r?.landmarks[0]) hand = { landmarks: r.landmarks[0], gesture: g?.categoryName ?? "None", score: g?.score ?? 0 };
  } finally {
    bitmap.close();
    post({ type: "hand", hand, ms });
  }
};
