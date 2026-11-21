// End-to-end check of a whole call, in two browsers with fake cameras.
//
// Needs both servers running (see README) and three accounts:
//   technician "ravi", expert "mehta" (Dr. Mehta), both with password E2E_PASSWORD.
// Run: npm run e2e        Screenshots go to SHOTS_DIR (default: ./test-results).
// If Playwright's own browser is not installed: npx playwright install chromium (or set CHROME_PATH).

import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import ts from "typescript";
import { makeClip, makeObjectClip } from "./make-clip.mjs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PASSWORD = process.env.E2E_PASSWORD ?? "demo-pass-1";
const SHOTS = process.env.SHOTS_DIR ?? "test-results";
const FAKE_HAND = process.env.E2E_FAKE_HAND === "1";
mkdirSync(SHOTS, { recursive: true });
// The technician's camera plays a textured panel with a blue dot (see make-clip.mjs): by default the camera
// moves over a still panel; with E2E_CLIP=object the camera is still and a card with the dot moves.
const OBJECT = process.env.E2E_CLIP === "object";
const CLIP_PATH = resolve(SHOTS, OBJECT ? "object.y4m" : "panel.y4m");
if (!existsSync(CLIP_PATH)) await (OBJECT ? makeObjectClip : makeClip)(CLIP_PATH);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-video-capture=${CLIP_PATH}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

async function signIn(context, username) {
  await context.grantPermissions(["camera", "microphone"], { origin: BASE });
  await context.addInitScript((frequency) => {
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getMedia(constraints);
      if (constraints.audio) {
        const audio = new AudioContext();
        const oscillator = audio.createOscillator();
        const output = audio.createMediaStreamDestination();
        oscillator.frequency.value = frequency;
        oscillator.connect(output);
        oscillator.start();
        await audio.resume();
        stream.getAudioTracks().forEach((track) => { stream.removeTrack(track); track.stop(); });
        stream.addTrack(output.stream.getAudioTracks()[0]);
        window.e2eAudio = audio;
      }
      return stream;
    };
  }, username === "ravi" ? 440 : 880);
  await context.addInitScript(() => {
    const startTone = OscillatorNode.prototype.start;
    window.e2eTones = [];
    OscillatorNode.prototype.start = function (...args) {
      window.e2eTones.push(this.frequency.value);
      return startTone.apply(this, args);
    };
    // Observe this test browser's own Socket.IO connection; no test hook is shipped in the app.
    const send = WebSocket.prototype.send;
    window.e2eShapes = [];
    window.e2eHandPuts = [];
    window.e2eEraseMessages = [];
    window.e2eUndoMessages = [];
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string") {
        window.e2eSocket = this;
        if (/^42\d*\[/.test(data)) {
          try {
            const [event, body] = JSON.parse(data.slice(data.indexOf("[")));
            if (event === "ann:put" && body?.shape?.anchor) window.e2eShapes.push(body.shape);
            if (event === "ann:put" && body?.shape?.via === "hand") window.e2eHandPuts.push(body.shape);
            if (event === "ann:erase") window.e2eEraseMessages.push(body);
            if (event === "ann:erase:undo") window.e2eUndoMessages.push(body);
          } catch {}
        }
      }
      return send.call(this, data);
    };
    // Where the blue dot (camera picture) and the orange drawing are on the first canvas, as fractions of its width.
    window.findColours = () => {
      const c = document.querySelector("canvas");
      if (!c?.width) return {};
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const sum = { blue: [0, 0, 0], orange: [0, 0, 0] };
      for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
        const k = b > 150 && r < 90 && g < 120 ? "blue" : r > 220 && g > 80 && g < 130 && b < 60 ? "orange" : null;
        if (k) sum[k][0] += x, sum[k][1] += y, sum[k][2]++;
      }
      const at = ([x, y, n]) => (n > 3 ? [x / n / c.width, y / n / c.width] : null);
      return { blue: at(sum.blue), orange: at(sum.orange), orangeCount: sum.orange[2] };
    };
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => {
    pageErrors.push(`${username}: ${e.message}`);
    console.error(`[${username}] page error:`, e.stack);
  });
  page.on("console", (m) => (m.type() === "error" || /could not start|will not follow/.test(m.text())) && console.error(`[${username}] console:`, m.text()));
  // Closed network: nothing may leave our own server (the STUN server is not a web request, so it is not seen here).
  page.on("requestfinished", (r) => !r.url().startsWith(BASE) && /^https?:/.test(r.url()) && outside.push(r.url()));
  pages.push(page);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" }); // let the page's script load first
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  return page;
}

const step = (text) => console.log(`- ${text}`);
const pages = [];
const outside = [];
const pageErrors = [];

try {
  const expert = await signIn(await browser.newContext({ viewport: { width: 1440, height: 900 } }), "mehta");
  await expert.waitForURL("**/expert");
  await expert.getByText("No one is waiting").waitFor();
  // Exercise the production drawing renderer on real canvas pixels, including overlapping cutouts.
  const annotationSource = await readFile(resolve("lib/annotations.ts"), "utf8");
  const renderer = ts.transpileModule(annotationSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const erasedPixels = await expert.evaluate(async (source) => {
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    try {
      const { drawShapes } = await import(url);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 100;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, 100, 100);
      const a = [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]];
      const b = [[0.45, 0.4], [0.65, 0.4], [0.65, 0.6], [0.45, 0.6]];
      drawShapes(ctx, [
        { id: "white", author: 1, tool: "pen", color: "white", points: [[0.1, 0.5], [0.9, 0.5]], erasures: { rub: [a, b] } },
        { id: "red", author: 2, tool: "pen", color: "red", points: [[0.5, 0.1], [0.5, 0.9]] },
      ], { x: 0, y: 0, w: 100, h: 100 }, "sans-serif");
      return [30, 50, 57, 75].map((x) => [...ctx.getImageData(x, 50, 1, 1).data].slice(0, 3));
    } finally { URL.revokeObjectURL(url); }
  }, renderer);
  assert.ok(erasedPixels[0][0] > 200 && erasedPixels[3][0] > 200, "the untouched ends remain");
  assert.ok(erasedPixels[1][0] > 200 && erasedPixels[1][1] < 50, "erasing one shape does not erase another");
  assert.ok(erasedPixels[2][0] < 50, "overlapping eraser passes stay erased");
  step("partial erasing clips only the selected drawing");
  await shot(expert, "01-expert-waiting");
  step("expert signed in and waiting");

  const techContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  if (FAKE_HAND) {
    // The hand worker's file name: in the production build, the chunk that mentions the model; under
    // `next dev` (Turbopack), the worker's entry chunk (older ones are harmless: they are never requested).
    const handChunks = [];
    const directory = resolve(".next/static/chunks");
    for (const name of (await readdir(directory).catch(() => [])).filter((f) => f.endsWith(".js"))) {
      if ((await readFile(resolve(directory, name), "utf8")).includes("/vendor/mediapipe/gesture_recognizer.task")) handChunks.push(name);
    }
    handChunks.push(...(await readdir(resolve(".next/dev/static/chunks")).catch(() => [])).filter((f) => f.startsWith("turbopack-lib_ar_hands_worker")));
    assert.ok(handChunks.length, "find the hand worker in the build");
    await techContext.addInitScript((chunks) => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          if (chunks.some((chunk) => String(url).includes(chunk))) {
            const source = `let hand = null; setTimeout(() => postMessage({type:'ready'}), 0); onmessage = ({data}) => { if ('testHand' in data) { hand = data.testHand; return; } data.bitmap.close(); postMessage({type:'hand', hand, ms:data.ms}); };`;
            super(URL.createObjectURL(new Blob([source], { type: "text/javascript" })), options);
            window.e2eHandWorker = this;
          } else super(url, options);
        }
      };
    }, handChunks);
  }
  const tech = await signIn(techContext, "ravi");
  await tech.waitForURL("**/tech");
  await tech.getByLabel("Aircraft").fill("VT-ABC");
  await tech.getByLabel("Checklist").selectOption({ label: "Engine assembly check" });
  await shot(tech, "02-tech-home");
  await tech.getByRole("button", { name: "Call an expert" }).click();
  await tech.waitForURL(/\/tech\/session\/\d+/);
  const sessionId = tech.url().split("/").pop();
  await tech.getByText("Calling an expert…").waitFor();
  await shot(tech, "03-tech-calling");
  step(`technician is calling (session ${sessionId})`);

  const dialog = expert.getByRole("dialog", { name: "Incoming call" });
  await expert.waitForFunction(() => window.e2eTones.includes(660), null, { timeout: 10000 });
  await dialog.getByText("Ravi Kumar").waitFor();
  await shot(expert, "04-expert-incoming");
  await dialog.getByRole("button", { name: "Accept" }).click();
  await expert.waitForURL(`**/expert/session/${sessionId}`);
  step("expert accepted");

  await expert.waitForFunction(() => {
    const v = document.querySelector("video");
    return v && v.videoWidth > 0 && v.currentTime > 0;
  }, null, { timeout: 20000 });
  await tech.getByRole("button", { name: "End call" }).waitFor();
  step("video is flowing from the technician to the expert");

  // The expert can place a drawing using only a keyboard.
  const keyboardCanvas = expert.locator("canvas");
  await keyboardCanvas.focus();
  assert.equal(await keyboardCanvas.evaluate((el) => document.activeElement === el), true, "drawing area accepts keyboard focus");
  await expert.keyboard.press("Enter");
  await expert.keyboard.press("ArrowRight");
  await expert.keyboard.press("ArrowDown");
  await expert.keyboard.press("Enter");
  await tech.waitForFunction(() => findColours().orangeCount > 3, null, { timeout: 5000 });
  await expert.getByRole("button", { name: "Clear all" }).click();
  step("expert draws with the keyboard");

  // Expert draws an arrow; it must appear on the technician's screen.
  const box = await expert.locator("canvas").boundingBox();
  await expert.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expert.mouse.down();
  await expert.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.6, { steps: 8 });
  const drawnAt = Date.now();
  await expert.mouse.up();
  // Solid orange on the technician's canvas (a faded or dashed "searching" drawing would not pass).
  await tech.waitForFunction(() => findColours().orangeCount > 3, null, { timeout: 5000 });
  const arrived = Date.now() - drawnAt;
  assert.ok(arrived <= 1000, `the expert's arrow took ${arrived} ms to reach the technician (limit 1000)`);
  // ... and it stays solid and on screen while the camera picture moves and the tech's tracker finds the anchor.
  const solid = [];
  for (let i = 0; i < 15; i++) {
    solid.push((await tech.evaluate(() => findColours())).orangeCount ?? 0);
    await tech.waitForTimeout(200);
  }
  assert.ok(solid.every((n) => n > 3), `the expert's arrow faded or left the technician's screen: orange pixels per sample ${solid.join(",")}`);
  step(`expert's arrow appears on the technician's phone in ${arrived} ms and stays solid for 3 s`);

  // AR: a box drawn round the blue dot must stay on the dot on both screens while the camera moves.
  await expert.getByRole("button", { name: "Clear all" }).click();
  await expert.getByRole("button", { name: "Box" }).click();
  await Promise.all([expert, tech].map((p) => p.waitForFunction(() => !!findColours().blue, null, { timeout: 15000 }).catch(() => {
    throw new Error("The camera picture is not drawn on the canvas, so drawings cannot follow it (AR did not start).");
  })));
  // As an expert would: freeze the moving picture, box the part, resume.
  await expert.getByRole("button", { name: "Freeze" }).click();
  await expert.waitForTimeout(400);
  const frozenDot = { technician: (await tech.evaluate(() => findColours())).blue, expert: (await expert.evaluate(() => findColours())).blue };
  const dot = frozenDot.expert;
  const r = 35;
  await expert.mouse.move(box.x + dot[0] * box.width - r, box.y + dot[1] * box.width - r);
  await expert.mouse.down();
  await expert.mouse.move(box.x + dot[0] * box.width + r, box.y + dot[1] * box.width + r, { steps: 4 });
  await expert.mouse.up();
  await expert.getByRole("button", { name: "Resume" }).click();
  // The part has moved meanwhile: both sides must find it again.
  const resumed = Date.now();
  for (const [name, page] of [["technician", tech], ["expert", expert]]) {
    await page.waitForFunction((was) => {
      // The live picture is back (the dot has moved since the freeze) and the box is on the dot again.
      const { blue, orange } = findColours();
      return blue && orange && Math.hypot(blue[0] - was[0], blue[1] - was[1]) > 0.03 && Math.hypot(blue[0] - orange[0], blue[1] - orange[1]) < 0.02;
    }, frozenDot[name], { timeout: 5000, polling: 100 }).catch(() => { throw new Error(`${name}: the box was not found again within 5 s of resuming`); });
    step(`AR: the ${name}'s screen found the part again ${Date.now() - resumed} ms after resuming`);
  }
  for (const [name, page] of [["technician", tech], ["expert", expert]]) {
    const seen = [];
    for (let i = 0; i < 10; i++) {
      seen.push(await page.evaluate(() => findColours()));
      await page.waitForTimeout(200);
    }
    const f = (p) => (p ? p.map((v) => v.toFixed(3)).join(",") : "none");
    const report = seen.map((x) => `dot ${f(x.blue)} box ${f(x.orange)}`).join("\n    ");
    assert.ok(seen.every((x) => x.blue && x.orange), `${name}: dot or box missing:\n    ${report}`);
    const xs = seen.map((x) => x.blue[0]);
    const worst = Math.max(...seen.map((x) => Math.hypot(x.blue[0] - x.orange[0], x.blue[1] - x.orange[1])));
    assert.ok(Math.max(...xs) - Math.min(...xs) > 0.04, `${name}: the camera should be moving:\n    ${report}`);
    assert.ok(worst < 0.03, `${name}: the box left the dot by ${(worst * 100).toFixed(1)}% of the width:\n    ${report}`);
    if (process.env.AR_REPORT) console.log(`    ${name}:\n    ${report}`);
    step(`AR: box stays on the moving part on the ${name}'s screen (worst ${(worst * 100).toFixed(1)}% of the width, dot moved ${((Math.max(...xs) - Math.min(...xs)) * 100).toFixed(0)}%)`);
  }
  // Speed, as the AR debug panel shows it (window.arguideStats, see lib/ar/stats.ts).
  const speed = await tech.evaluate(() => ({ ...window.arguideStats }));
  step(`speed on the technician's page: tracker ${speed.trackFps}/s (${speed.trackMs.toFixed(0)} ms, ${speed.trackSize}px), hands ${speed.handFps}/s (${speed.handMs.toFixed(0)} ms)`);
  // The hand recogniser looks at the camera on its own, so it is not held back by the tracker. (With generated hands
  // the recogniser is instant, so this shows the loop itself; the real recogniser's speed is the figure above.)
  if (FAKE_HAND) assert.ok(speed.handFps >= 20, `the hand loop ran at only ${speed.handFps}/s`);
  await shot(tech, "04b-tech-ar-box");
  await shot(expert, "04c-expert-ar-box");

  // Capture the moving annotated picture and record it before the mark is cleared.
  await expert.getByRole("button", { name: "Photo" }).click();
  await expert.getByText("Photo saved to the session.").waitFor();
  await expert.getByRole("button", { name: "Record" }).click();
  await tech.getByRole("dialog", { name: "Recording request" }).getByRole("button", { name: "Allow", exact: true }).click();
  await tech.getByText("Recording", { exact: true }).waitFor();
  await expert.waitForTimeout(2500);
  await expert.getByRole("button", { name: "Stop recording" }).click();
  await expert.getByText("Recording saved to the session.").waitFor({ timeout: 15000 });

  if (FAKE_HAND) {
    // Feed synthetic landmarks through the actual hand state machine and UI; the camera is still the moving panel.
    await tech.waitForFunction(() => window.e2eHandWorker && findColours().blue, null, { timeout: 10000 });
    const setHand = async (follow) => tech.evaluate((follow) => {
      const canvas = document.querySelector("canvas"), video = document.querySelector("video");
      const dot = findColours().blue;
      if (!dot || !video.videoWidth || !video.videoHeight) return;
      const scale = Math.min(canvas.clientWidth / video.videoWidth, canvas.clientHeight / video.videoHeight);
      const width = video.videoWidth * scale, height = video.videoHeight * scale;
      const x = (dot[0] * canvas.clientWidth - (canvas.clientWidth - width) / 2) / width;
      const y = (dot[1] * canvas.clientWidth - (canvas.clientHeight - height) / 2) / height;
      if (!window.e2ePalm || follow) window.e2ePalm = [x, y];
      const [px, py] = window.e2ePalm;
      const p = Array.from({ length: 21 }, () => ({ x: px, y: py, z: 0 }));
      p[0] = { x: px, y: py + 0.05, z: 0 };
      p[5] = { x: px - 0.035, y: py - 0.025, z: 0 };
      p[17] = { x: px + 0.035, y: py - 0.025, z: 0 };
      p[8] = { x: px + 0.01, y: py - 0.1, z: 0 };
      p[4] = { x: px + 0.20, y: py - 0.1, z: 0 };
      window.e2eHandWorker.postMessage({ testHand: { landmarks: p, gesture: "Open_Palm", score: 0.99 } });
    }, follow);
    // An open palm that moves rubs at once (no hold first).
    await setHand(false);
    for (let i = 0; i < 20; i++) {
      await setHand(true);
      await tech.waitForTimeout(80);
    }
    await tech.getByText("Rubbing out…").waitFor({ timeout: 5000 });
    await tech.waitForFunction(() => window.e2eEraseMessages.some((m) => m.changes.length), null, { timeout: 5000 });
    await tech.evaluate(() => window.e2eHandWorker.postMessage({ testHand: null }));
    await tech.getByText("Rubbing out…").waitFor({ state: "detached", timeout: 5000 });
    await tech.getByRole("button", { name: "Undo", exact: true }).click();
    await tech.waitForFunction(() => window.e2eUndoMessages.length > 0, null, { timeout: 5000 });
    step("synthetic open palm rubs at once, and Undo passes through the call");

    // A pinch stroke through the real state machine, stage and socket: one unbroken line, not a row of fragments.
    const before = await tech.evaluate(() => ({ ...window.arguideStats }));
    for (let i = 0; i < 25; i++) {
      await tech.evaluate((i) => {
        const x = 0.3 + i * 0.01, y = 0.4;
        const p = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
        p[0] = { x, y: y + 0.12, z: 0 };
        p[5] = { x: x - 0.035, y: y + 0.05, z: 0 };
        p[17] = { x: x + 0.035, y: y + 0.05, z: 0 };
        p[8] = { x, y, z: 0 };
        p[4] = { x: x + 0.01, y, z: 0 }; // thumb and index fingertip touching
        window.e2eHandWorker.postMessage({ testHand: { landmarks: p, gesture: "None", score: 0.9 } });
      }, i);
      await tech.waitForTimeout(40);
    }
    await tech.evaluate(() => window.e2eHandWorker.postMessage({ testHand: null }));
    await tech.waitForFunction((n) => window.arguideStats.strokesEnded > n, before.strokesEnded, { timeout: 5000 });
    const after = await tech.evaluate(() => ({ ...window.arguideStats, line: window.e2eHandPuts.at(-1) }));
    assert.equal(after.strokesStarted - before.strokesStarted, 1, "one pinch is one stroke");
    assert.equal(after.strokesEnded - before.strokesEnded, 1, "and it ends once");
    assert.ok(after.line.points.length >= 15, `the pinch line has only ${after.line.points.length} points`);
    step(`synthetic pinch draws one unbroken line of ${after.line.points.length} points`);
  }

  // Send the same validated erase operation a hand gesture produces and check both actual canvases.
  await expert.getByRole("button", { name: "Freeze" }).click();
  await tech.getByText("Picture frozen by Dr. Mehta").waitFor();
  await expert.waitForFunction(() => window.e2eShapes.some((s) => s.tool === "rect" && s.anchor), null, { timeout: 5000 });
  await tech.waitForFunction(() => window.e2eSocket?.readyState === WebSocket.OPEN, null, { timeout: 5000 });
  await expert.waitForTimeout(400);
  const beforeRub = await Promise.all([expert, tech].map((p) => p.evaluate(() => findColours().orangeCount)));
  const shape = await expert.evaluate(() => window.e2eShapes.findLast((s) => s.tool === "rect" && s.anchor));
  const [a, b] = shape.points;
  const x = (a[0] + b[0]) / 2, y = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]) * 0.3;
  const polygon = [[x - w, y - 0.015], [x + w, y - 0.015], [x + w, y + 0.015], [x - w, y + 0.015]];
  await tech.evaluate(({ sessionId, shapeId, polygon }) => window.e2eSocket.send(`42${JSON.stringify(["ann:erase", { sessionId: Number(sessionId), opId: "e2e-rub", batch: 0, changes: [{ id: shapeId, polygon }] }])}`), { sessionId, shapeId: shape.id, polygon });
  await Promise.all([expert, tech].map((p, i) => p.waitForFunction((before) => findColours().orangeCount < before * 0.97, beforeRub[i], { timeout: 5000 })));
  const afterRub = await Promise.all([expert, tech].map((p) => p.evaluate(() => findColours().orangeCount)));
  assert.ok(afterRub.every((n, i) => n > beforeRub[i] * 0.3), "rubbing keeps most of the box");
  await tech.evaluate((sessionId) => window.e2eSocket.send(`42${JSON.stringify(["ann:erase:undo", { sessionId: Number(sessionId), opId: "e2e-rub" }])}`), sessionId);
  await Promise.all([expert, tech].map((p, i) => p.waitForFunction((before) => findColours().orangeCount >= before * 0.98, beforeRub[i], { timeout: 5000 })));
  step("partial rubbing and undo update both screens");
  await expert.getByRole("button", { name: "Resume" }).click();
  await expert.getByRole("button", { name: "Clear all" }).click();

  await expert.getByRole("button", { name: "Freeze" }).click();
  await tech.getByText("Picture frozen by Dr. Mehta").waitFor();
  await shot(tech, "05-tech-live-frozen");
  await shot(expert, "06-expert-console-frozen");
  await expert.getByRole("button", { name: "Resume" }).click();
  await tech.getByText("Picture frozen by Dr. Mehta").waitFor({ state: "detached" });
  step("freeze and resume reach the technician");

  await tech.getByRole("region", { name: "Current step" }).getByRole("button", { name: "Done" }).click();
  await expert.getByText(/Done, Ravi Kumar/).first().waitFor();
  step("technician's step result shows on the expert's checklist");

  await expert.getByRole("tab", { name: /Chat/ }).click();
  await expert.getByLabel("Message").fill("Check the clamp near the fuel line");
  await expert.getByRole("button", { name: "Send" }).click();
  await tech.getByRole("button", { name: "Chat (1)" }).waitFor();
  step("chat message arrives");

  await expert.getByRole("tab", { name: "Checklist" }).click();
  const panel = expert.getByRole("tabpanel");
  const open = panel.getByRole("button", { name: "Done", exact: true }).and(panel.locator(":enabled"));
  for (let i = 0; i < 6; i++) {
    const before = await open.count();
    await open.first().click();
    // Wait until the step's result has come back, or the next click would hit the same step again.
    for (let t = 0; t < 50 && (await open.count()) >= before; t++) await expert.waitForTimeout(100);
  }
  await panel.getByRole("button", { name: "Sign off checklist" }).click();
  await panel.getByText("SIGNED OFF").waitFor();
  await tech.getByText("SIGNED OFF").waitFor();
  await shot(tech, "07-tech-signed-off");
  await shot(expert, "08-expert-signed-off");
  step("checklist signed off; stamp shows on both sides");

  // The technician can end the call while the expert is still recording.
  await expert.getByRole("button", { name: "Record" }).click();
  await tech.getByRole("dialog", { name: "Recording request" }).getByRole("button", { name: "Allow", exact: true }).click();
  await tech.getByText("Recording", { exact: true }).waitFor();
  await expert.waitForTimeout(1500);
  await tech.getByRole("button", { name: "End call" }).click();
  await expert.getByText("Recording saved to the session.").waitFor({ timeout: 15000 });
  await tech.getByText("Call ended").waitFor();
  await shot(tech, "09-tech-ended");
  step("call ended on both sides");

  await expert.goto(`${BASE}/sessions/${sessionId}`);
  await expert.getByRole("heading", { name: "Session report" }).waitFor();
  await expert.getByRole("img", { name: /Photo by Dr. Mehta/ }).waitFor();
  assert.equal(await expert.locator("video").count(), 2, "both recordings are on the report");
  const evidence = await expert.evaluate(async () => {
    const photo = document.querySelector('img[alt^="Photo by"]');
    const recording = document.querySelector("video");
    await photo.decode();
    await new Promise((resolve, reject) => {
      recording.addEventListener("loadeddata", resolve, { once: true });
      recording.addEventListener("error", reject, { once: true });
      recording.load();
    });
    recording.currentTime = 1;
    await new Promise((resolve) => recording.addEventListener("seeked", resolve, { once: true }));
    const hasOrange = (source, w, h) => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(source, 0, 0, w, h);
      const pixels = ctx.getImageData(0, 0, w, h).data;
      let n = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 190 && pixels[i + 1] > 45 && pixels[i + 1] < 155 && pixels[i + 2] < 95) n++;
      return n > 30;
    };
    const audio = new AudioContext();
    const decoded = await audio.decodeAudioData(await (await fetch(recording.currentSrc)).arrayBuffer());
    const samples = decoded.getChannelData(0);
    const power = (frequency) => {
      let real = 0, imaginary = 0;
      for (let i = 0; i < samples.length; i++) {
        const angle = 2 * Math.PI * frequency * i / decoded.sampleRate;
        real += samples[i] * Math.cos(angle);
        imaginary += samples[i] * Math.sin(angle);
      }
      return 2 * Math.hypot(real, imaginary) / samples.length;
    };
    const tones = [power(440), power(880)];
    await audio.close();
    return { photo: hasOrange(photo, photo.naturalWidth, photo.naturalHeight), recording: hasOrange(recording, recording.videoWidth, recording.videoHeight), tones };
  });
  assert.ok(evidence.photo, "saved photo contains the drawing");
  assert.ok(evidence.recording, "saved recording contains the drawing");
  assert.ok(evidence.tones.every((tone) => tone > 0.005), `recording includes both participants' audio: ${evidence.tones}`);
  const endedRecordingHasPicture = await expert.locator("video").nth(1).evaluate(async (recording) => {
    if (recording.readyState < 2) await new Promise((resolve, reject) => {
      recording.addEventListener("loadeddata", resolve, { once: true });
      recording.addEventListener("error", reject, { once: true });
      recording.load();
    });
    recording.currentTime = 0.5;
    await new Promise((resolve) => recording.addEventListener("seeked", resolve, { once: true }));
    const canvas = document.createElement("canvas");
    canvas.width = recording.videoWidth; canvas.height = recording.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(recording, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 !== 3 && value > 40);
  });
  assert.ok(endedRecordingHasPicture, "recording saved when the technician ends has a visible picture");
  await expert.screenshot({ path: `${SHOTS}/10-report.png`, fullPage: true });
  await expert.goto(`${BASE}/sessions`);
  await expert.getByRole("link", { name: /SES-0*\d+/ }).first().waitFor();
  await shot(expert, "11-sessions");
  await expert.goto(`${BASE}/expert`);
  await expert.getByText("Last 7 days").waitFor();
  await shot(expert, "12-expert-home-stats");
  step("report, session list and numbers show the call");

  assert.deepEqual(outside, [], "requests left our own server");
  assert.deepEqual(pageErrors, [], "an application page raised an error");
  step("nothing was sent outside our own server");

  console.log("\nAll end-to-end checks passed.");
} catch (e) {
  console.error("\nEnd-to-end check FAILED:", e.message);
  process.exitCode = 1;
  for (const [i, p] of pages.entries()) await p.screenshot({ path: `${SHOTS}/failure-${i}.png` }).catch(() => {});
} finally {
  await browser.close();
}
