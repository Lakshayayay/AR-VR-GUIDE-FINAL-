> Approved by the owner on 2026-11-16 ("implement the plan"). Build progress is in [`STATUS.md`](../STATUS.md); results of Stage 0 are at the end of this file.
>
> **Partly superseded (2026-11-21).** Stages 0 to 2 were built; §15 and §16 record how. What to do next is in [`PLAN.md`](PLAN.md). Parts that no longer hold: §6 gesture table (palm-hold undo and wave-to-clear were replaced by buttons; rubbing now starts at once, not after a hold); §7 "outline replaced by a cursor" (the hand outline is back, with a Guide toggle); Stage 0 step 5 (the owner cannot supply phone clips).

# ArGuide AR core: drawings that stick to the part + hands-free pinch drawing

## 1. Context (why this work)

The refurbished app (`web/` + `backend/`) shows drawings as a flat whiteboard fixed to the screen. The owner tried it on 2026-11-16 and said this misses the main point of the product: **augmented reality**. In the old demo, an expert's drawing stayed on the aircraft part as the camera moved, and the technician drew in the air by pinching, with both hands free. The earlier refurbish plan had parked both features under "Later, with the AI phase" (`docs/REFURBISH_PLAN.md` line 315). The owner now wants them back, on the refurbish branch, working better than the demo: accurate, smooth, and nothing from the old demo lost.

Outcome wanted: a technician with a phone mounted on chest or helmet keeps both hands on the job, points and pinch-draws on the real part, and the expert's drawings stay glued to the part while the technician moves.

## 2. Inspection: what I found

### The old demo (read in full: `ArGuide/temp_ui/technician/src/app/components/LiveSession.tsx`, `AR.tsx`, `ArGuide/expert-dashboard/src/app/App.tsx`, `ArGuide/server/index.js`)

| Feature | How it really worked | Limit |
|---|---|---|
| Drawings stick (`LiveSession.tsx:246-387`) | On the expert's first drawing it saved a 64-pixel square of the picture, found that square again every 33 ms, and slid **all** drawings by the same amount | Slides only: no turning, zooming or tilting. One square for every drawing. Heavy smoothing made drawings trail behind. Never re-found a lost square |
| Expert also sees it stick (`tracking_update`, `App.tsx:527-533`) | The phone sent the slide amount to the expert 30 times a second | It arrived sooner than the video, so on the expert's screen drawings ran ahead of the picture while the camera moved |
| Pinch drawing (`LiveSession.tsx:663-801`) | MediaPipe Hands; "pinch" when thumb and index tips were closer than a fixed number | Model fetched from the internet (`:672`). The fixed number fails when the hand is nearer or farther. Lines broke into pieces. The library is retired |
| Fingertip dot, wave to clear | Dot followed the index finger on the phone only; a sideways wrist move cleared everything | Expert never saw the dot. Wave fired by accident |
| three.js (`:483-571`) | Drew lines as thin tubes at a made-up depth | Not real 3D. It did the job of a flat drawing |
| OpenCV | **Not in the code on any branch** (`main`, `ai-copilot`, `origin/features` all searched) | The tracking was hand-written. OpenCV is the right tool to add now |

### The new app today
Drawings are shapes with points stored as fractions of the picture (`web/lib/annotations.ts`), drawn on a 2D canvas over the video by one shared component (`web/components/call/stage.tsx`), sent with `ann:put` and kept by the server for rejoin (`backend/app/realtime.py:252-279`). No tracking, no hands. This is a clean base: the AR work plugs into `Stage` and `Shape` without touching the call set-up.

### Facts checked, and how sure

| Fact | Source | Status |
|---|---|---|
| Web pages get real 3D AR on Android Chrome (ARCore), not on iPhone Safari | [BrowserStack guide](https://www.browserstack.com/guide/webxr-and-compatible-browsers), [Wikipedia: WebXR](https://en.wikipedia.org/wiki/WebXR) | Likely. Confirm on MDN / caniuse in Stage 0 |
| MediaPipe Gesture Recognizer gives hand points plus ready-made gestures (Open_Palm, Pointing_Up, Thumb_Up, Closed_Fist, Victory) and can load its files from our own server | [Google's official web guide](https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer/web_js) | Confirmed for gestures. Self-hosting to be proven in Stage 0 |
| Current packages: `@mediapipe/tasks-vision` 1.2.3, `@techstark/opencv-js` 5.0.0, both Apache-2.0 | npm registry, checked 2026-11-16 | Confirmed |
| The OpenCV.js build includes the five functions we need (`ORB`, `BFMatcher`, `calcOpticalFlowPyrLK`, `goodFeaturesToTrack`, `findHomography`) | Forum posts disagree | **Not confirmed.** First check in Stage 0 |

## 3. What the owner decided (2026-11-16)

- Device: Android and iPhone both, not fixed yet. Build what works on every phone; real 3D is an Android-only extra.
- Phone is **mounted on chest or helmet**. The technician mostly cannot see or touch the screen, so feedback is by sound and the expert can switch hand mode on and off.
- Approach: **every phone first, real 3D after.**

## 4. Goals, non-goals, failure

| | |
|---|---|
| **Goals** | Each drawing stays on the part while the camera moves, turns, zooms and tilts, on both screens. Lost drawings come back when the part is in view again. Pinch drawing, fingertip pointing, undo and clear by hand. Everything runs on the phone with no internet |
| **Not in this plan** | Gemini, defect detection, any cloud AI. Voice commands (Chrome's speech recognition uses the internet). Marking checklist steps by gesture (an accidental thumbs-up must not tick a pre-flight step; the expert can already mark steps). Smart glasses |
| **Would count as failure** | Drawings that wobble or trail behind the picture. Hand drawing that fires by accident. Anything fetched from an outside site during a call. The plain call, checklist, chat, photos or report breaking |

## 5. Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| A. Feature tracking in the browser (OpenCV.js), then a real-3D trial | Works on every phone and on the expert's laptop. Assumes the area around a drawing is roughly flat | **Chosen** |
| B. Real 3D only (Android ARCore through WebXR) | True depth, but no iPhone, and it replaces how the camera feeds the call | Becomes Stage 4, as a trial |
| C. Copy the old demo | Fast, keeps every limit in the table above, breaks the closed-network rule | Rejected |

## 6. How it will work

**Sticky drawings.** When someone draws, the app saves a small grey picture of the area around the drawing (the "anchor"). On every video frame a background worker follows a few hundred corner points near each drawing (OpenCV: Lucas-Kanade optical flow) and works out how that patch of surface has moved, turned, grown or tilted (a homography, with RANSAC so a hand passing in front does not pull it off). The drawing is redrawn through that movement on the same frame, so it does not trail. About once a second, and whenever it is lost, the worker matches the saved anchor picture against the live picture (ORB features) to remove drift and to re-find it.

**Each screen tracks its own picture.** The anchor picture travels with the shape. The expert's browser runs the same tracker on the video it receives. This fixes two problems of the old demo at once: the expert's drawings no longer run ahead of the video, and a drawing made on a slightly older frame (network delay) is placed on the right physical spot on the phone. Rejoin and freeze/resume use the same "find the anchor" step.

**Hands.** MediaPipe Gesture Recognizer runs on the phone from files we host ourselves.

| Hand action | Result | Sound |
|---|---|---|
| Point with index finger | Expert sees a pointer at the fingertip (existing `pointer` event) | none |
| Pinch thumb and index, move | One smooth green line, anchored to the part behind the fingertip | tick on start, tock on end |
| Open palm held 1 s | Undo own last drawing (existing `call.undo`) | double tick |
| Open palm waved side to side twice | Clear all (old demo's gesture, harder to trigger by accident) | triple tick |

Pinch is measured as finger gap divided by palm width, so it works at any distance, with separate start and stop levels so lines do not break. The fingertip is smoothed with a One Euro filter (steady when still, quick when moving). Points are stored in the anchor's coordinates, so a line drawn while walking stays in one piece.

## 7. Nothing from the old demo is lost

| Old demo | New |
|---|---|
| Expert drawing slides with the picture | Stage 1: also turns, zooms, tilts; each drawing has its own anchor; comes back after being lost |
| Expert sees the same | Stage 1: expert's screen tracks its own video, no mismatch |
| Pinch to draw | Stage 2, unbroken lines |
| Fingertip dot | Stage 2, and the expert now sees it |
| Wave to clear | Stage 2, plus undo |
| Hand skeleton overlay | Replaced by a small fingertip cursor (ring = pointing, filled = drawing) |
| Arrow, circle, box, pen, text, colours, freeze, clear | Already in the new app; all become anchored |
| three.js tubes | Flat lines that turn and tilt with the surface. three.js returns in Stage 4, where real 3D needs it |

## 8. Stages

### Stage 0: record the decision and prove the tools (small)
1. Update `STATUS.md` (§1, §2, §5, §8, session log), `AGENTS.md` (rule change, §10 below), `docs/REFURBISH_PLAN.md` §13, and the project memory. Copy this plan to `docs/AR_CORE_PLAN.md`.
2. Read `web/node_modules/next/dist/docs/` on Web Workers and static files (required by `web/AGENTS.md`).
3. Throwaway test page (deleted after): load OpenCV.js in a worker and print whether the five functions exist; load Gesture Recognizer from local files with the network tab showing no outside requests; show milliseconds per frame. Owner opens it on their phone (and an iPhone if one is available).
4. Decision gate: if a function is missing, use `estimateAffinePartial2D` or a hand-written 4-point RANSAC (about 80 lines) or a custom build; if the phone is slow, lower the analysis size or frame rate.
5. Owner records three 20-second clips with the phone held at chest height: a part with labels and bolts, bare shiny metal, dim light. Kept locally (git-ignored) for repeatable testing.

Done when: the test page shows green on the owner's phone and the docs record the decision.

### Stage 1: drawings that stick (large)
1. `web/lib/ar/anchor-core.ts`: pure functions over OpenCV: `makeRef` (anchor picture + features for an area), `locate` (ORB match + RANSAC), `track` (LK with forward-backward check + RANSAC, top-up of points, hand box masked out). Every OpenCV `Mat` is deleted after use.
2. `web/lib/ar/anchor-core.test.ts` (runs with `node --test`; Node 24 reads TypeScript directly): a generated textured image moved by known amounts. See §12 for pass marks.
3. `web/lib/ar/anchor.worker.ts`: takes the newest frame (downscaled to 480 wide), skips frames if busy, posts one transform and a state (`locked` / `searching`) per drawing.
4. `web/lib/ar/use-anchors.ts`: hook used by `Stage`; starts the worker only on call pages, feeds frames with `requestVideoFrameCallback`.
5. `web/lib/annotations.ts`: `Shape` gains `anchor?: { img, box }` and `via?: "hand"`; new `project(shape, transform)`; boxes and circles become outlines so they turn and tilt; text stays upright; `searching` drawings are drawn dashed and faded; `capture()` uses the transforms.
6. `web/components/call/stage.tsx`: redraw per video frame; on pointer down create the anchor from the current frame; map later points back through the inverse transform.
7. `web/components/call/use-call.ts` + `backend/app/realtime.py`: the anchor is sent once; server merges updates (`old | new`) and rejects anchor pictures over 20 KB. Add to `backend/tests/test_call_flow.py`: anchor survives an update and comes back on rejoin.
8. Expert console: when an anchor has too little detail, show a caution hint: "Not enough detail here to hold the drawing. Freeze the picture, or draw near an edge or label."

Done when: §12 tracker tests pass, and in a two-tab call a drawn box stays on a moving test picture on both screens.

### Stage 2: hands (medium)
1. Add `@mediapipe/tasks-vision`; `web/scripts/copy-vendor.mjs` (run on `postinstall`) copies its `wasm/` folder to `web/public/vendor/mediapipe/` (git-ignored); commit `gesture_recognizer.task` (about 8 MB, Apache-2.0) there so closed networks work.
2. `web/lib/ar/hands.ts`: recognizer wrapper, One Euro filter, pinch state machine, gesture-to-action table from §6. Tuning numbers sit as named constants at the top.
3. `web/lib/ar/hands.test.ts`: recorded and synthetic finger positions (§12).
4. Technician screen (`web/app/(app)/tech/session/[id]/page.tsx`): "Hands" control (56 px, labelled, on by default, remembered), fingertip cursor, "Hand seen" chip. Sounds added to `web/lib/ring.ts` beside `ringOnce()`; `navigator.vibrate` where the phone has it.
5. Expert console: "Hand drawing" switch, relayed with a new `hands` event (added to `RELAYED` in `realtime.py`, kept for rejoin).

Done when: §12 hand tests pass and the owner draws an unbroken line by pinching in a real call.

### Stage 3: measure on real phones, polish, document (small to medium)
Tune the constants with the owner on their phone and the three clips. Extend `web/e2e/call.mjs` with a moving textured fake camera (`--use-file-for-fake-video-capture`, clip generated at test time). Add gyro help only if fast head turns lose the lock. Update `README.md`, `STATUS.md`, `AGENTS.md` checks. Write the measured numbers and the limits into `STATUS.md`.

### Stage 4: real-3D trial on Android (separate go-ahead from the owner)
A throwaway page using WebXR (`immersive-ar`, `hit-test`, `anchors`, `camera-access`) and three.js answers three questions: can the AR camera picture be sent into the call at 24 frames a second or more; can a drawn point be turned into a real 3D point; how hot and how fast does the battery drain in 15 minutes. The owner then decides to keep or drop it. Drawing code does not change: Stage 4 would only be another source of per-drawing transforms.

## 9. Files

| New | Changed | Reused as is |
|---|---|---|
| `web/lib/ar/anchor-core.ts`, `anchor-core.test.ts`, `anchor.worker.ts`, `use-anchors.ts`, `hands.ts`, `hands.test.ts` | `web/lib/annotations.ts`, `web/components/call/stage.tsx`, `web/components/call/use-call.ts`, `web/lib/ring.ts` | `drawShapes`, `drawPointer`, `contentBox`, `newShapeId`, `TECH_COLOUR` (`web/lib/annotations.ts`) |
| `web/scripts/copy-vendor.mjs`, `web/public/vendor/mediapipe/gesture_recognizer.task` | both session pages under `web/app/(app)/` | `call.putShape`, `call.undo`, `call.clear`, `call.point` and the `sendSoon` once-per-frame pattern |
| `docs/AR_CORE_PLAN.md` | `backend/app/realtime.py`, `backend/tests/test_call_flow.py`, `web/e2e/call.mjs`, `web/package.json` | Freeze, rejoin, photo capture, the whole call set-up (`web/lib/webrtc.ts` untouched) |

`ArGuide/` is not changed.

## 10. Rule changes and my calls (the owner can overrule any of these)

| Item | Detail |
|---|---|
| **Rule change** | "No AI in this phase" becomes: on-device hand tracking (MediaPipe, our own files, no internet) is allowed for the AR core. Gemini, defect detection and all cloud AI stay off. The "no AI" search in `STATUS.md` §2 drops `mediapipe` from its pattern |
| Two new packages | `@techstark/opencv-js` (tracking maths that is not safe to hand-write) and `@mediapipe/tasks-vision` (hand tracking). Both load only on call pages |
| No three.js yet | The new 2D canvas already does what three.js did in the demo. It comes back in Stage 4 |
| No `tracking_update` stream | Each screen tracks its own picture: more accurate for the expert and less network traffic |
| Hands on by default | A chest-mounted phone cannot be tapped. The expert can switch it off |

## 11. Honest limits

- Needs visible detail (edges, labels, bolts, scratches). Blank shiny metal or dim light holds less well; the app says so and suggests Freeze.
- Around strongly 3D shapes seen from a very different angle, a drawing can slide a little, because the tracker treats the nearby surface as flat. Real 3D (Stage 4) is the fix.
- "In the air" means: the line lands on what the camera sees behind the fingertip. From a chest-mounted camera that matches what the technician means only when the pinch is close to the surface. True mid-air depth needs Stage 4.
- iPhone should work for Stages 1 to 3 but is unproven until Stage 0 runs on one.

## 12. Verification

| Check | Command or method | Pass mark |
|---|---|---|
| Tracker accuracy | `node --test web/lib/ar/` | Slide, 2x zoom, 30° turn, 30° tilt: average error ≤ 2 px, worst ≤ 5 px at 480 wide. Hidden for 15 frames, then re-locked within 15 frames. Stays locked with a moving block covering a quarter of the area |
| Pinch logic | same command | No start/stop flicker with noisy input at the threshold. Jitter of a still fingertip cut by 60% or more, lag under 2 frames |
| Server | `npm test` | Existing 5 pass, plus anchor merge/rejoin and `hands` relay |
| Types and build | `cd web && npx tsc --noEmit && npx next build` | Clean |
| Whole call | `npm run e2e` (both servers running) | Existing checks pass; drawn box follows the moving test picture on both screens |
| Closed network | Browser network tab during a call with hands on | No request to an outside host (STUN excepted) |
| Real phone (owner) | Mounted phone, 5 drawings, walk slowly around a part; pinch-draw for 20 s; work normally for 5 min | 24 frames a second or more; drawings stay on their spots and return after looking away; 0 broken lines; 0 accidental clears |

## 13. What's next

- On approval I start Stage 0: record the decision in the docs, then build the small test page.
- **Needed from the owner in Stage 0:** open one test link on the phone (and an iPhone if there is one), and record three short clips.
- Stage 4 (real 3D) starts only after a separate yes.

## 14. Stage 0 results (2026-11-16)

| Check | Result |
|---|---|
| OpenCV.js 5.0.0 functions | Present: `ORB`, `BFMatcher`, `calcOpticalFlowPyrLK`, `findHomography`, `perspectiveTransform`, `GFTTDetector`. Missing: `goodFeaturesToTrack` (we use `GFTTDetector`, the same corner finder), `estimateAffinePartial2D`. Loads in about 0.5 s |
| Hand model from our own files | Works in Chromium: loads in 0.17 s, about 19 ms a frame on a Mac (CPU), found the hand in a sample photo, **no request to any outside site** |
| iPhone engine (WebKit) | Not tested: the WebKit copy on this Mac doesn't match the test tool's version. Needs a real iPhone |
| Owner's phone test and three clips | Waiting on the owner |

**Loading:** `web/scripts/copy-vendor.mjs` (runs after `npm install`) copies `opencv.js` and MediaPipe's runtime into `web/public/vendor/` (git-ignored). The hand model `web/public/vendor/mediapipe/gesture_recognizer.task` (8.4 MB, Apache-2.0, from Google's MediaPipe model page) is kept in git so a closed network needs nothing from outside.

## 15. How the build differs from this plan (2026-11-16)

| Plan said | Built instead | Why |
|---|---|---|
| Follow points from picture to picture; re-match with ORB about once a second to remove drift | Follow points to predict, then line the live picture up with the anchor picture **every** picture | The first version drifted to 2 px average error in 45 pictures; lining up every picture gives 0.03 px |
| Analyse pictures 480 wide | 640 wide (pass marks converted to 480-wide pixels in the tests) | Anchor pictures need more pixels for ORB matching. `ANALYSIS_LONG_SIDE` is one number to lower if phones are slow |
| Finish a drawing by re-anchoring it in the current picture | `grow`: re-make the anchor in the drawing's original view (un-warping the live picture) | The drawing's points never change after it is drawn, for every tool |
| Anchor pictures up to 20 KB | Up to 40,000 characters; the worker lowers JPEG quality to fit | A busy 256 × 256 grey JPEG can exceed 20 KB once encoded for sending |
| Hand recogniser on the main thread | In its own worker, CPU only | Measured: on the main thread it froze the page for 5 to 12 s on a picture and starved the tracker |
| (not in plan) | `Content-Security-Policy: connect-src 'self' data: blob:` | MediaPipe posts usage logs to Google and has no switch; the browser now refuses |
| (not in plan) | Corner-strength floor in the tracker | Camera grain alone produced "corners" on a blank surface |
| "Hand seen" chip; Hands choice remembered on the phone | The Hands button's label shows the state (Hands on / Hand seen / Hands off / No hands); each call starts with hands on | One control instead of two; the owner wants hands on by default |
| Moving-camera e2e test in Stage 3 | Done in Stage 1, with a freeze → box → resume check on both screens and a "nothing sent outside" check | It was the right proof for Stage 1 |
| Owner's phone test, clips, tuning | Waiting on the owner | Needs the real device |
| Stage 4 (real 3D on Android) | Not started | Needs a separate go-ahead |

## 16. Improvement work (2026-11-16)

The owner chose a visible hand guide, pinch drawing, and partial erasing after holding an open palm. Palm-hold undo and wave-to-clear are replaced by buttons. Rubbing is stored as cutouts in each drawing's own anchor coordinates; the server relays and deduplicates erasing batches and keeps per-user undo history for rejoin. The ready state expires after two seconds if no rubbing begins. A frame used for hand recognition is derived from the same bitmap and tracker placements used for display. Stale hand results end active gestures. Anchor feature detection excludes the last recognized hand area. Photos and consented recordings use the composed frame.

Tests cover simulated gesture sequences, surface-relative erasing coordinates, server relay/undo/rejoin, real canvas pixels, synthetic tracker motion and generated-camera browser calls. The saved recording contains distinct generated audio signals from both participants, and is saved if the technician ends the call while recording. The owner cannot supply phones or recordings: real-hand gesture accuracy, camera movement while drawing, phone speed, gloves, shiny surfaces, dim light, real microphone audio and Android/iPhone compatibility remain unverified. The planar surface model remains a limitation. A separate owner decision is still required before a real-3D trial.

