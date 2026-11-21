// Copies the AR runtime files from node_modules into public/vendor, so the app serves them itself
// (closed-network ready: nothing is fetched from outside sites during a call). Runs after npm install.
// The hand model (public/vendor/mediapipe/gesture_recognizer.task) is kept in git; these copies are not.
import { cpSync, mkdirSync } from "node:fs";

const copies = [
  ["node_modules/@techstark/opencv-js/dist/opencv.js", "public/vendor/opencv/opencv.js"],
  ["node_modules/@mediapipe/tasks-vision/wasm", "public/vendor/mediapipe/wasm"],
];

for (const [from, to] of copies) {
  mkdirSync(to.slice(0, to.lastIndexOf("/")), { recursive: true });
  cpSync(from, to, { recursive: true });
}
console.log("AR files copied to public/vendor");
