# Plan: make the AR core work the way you tested it (in phases, with checks)

## Context

You tried the current app on 2026-11-21: Brave, laptop webcam, `next dev` server, technician and expert pages. You reported:

1. A pinch draws, but the line looks **dotted**, isn't smooth or accurate. You want the "accuracy path": more detail, very smooth AR.
2. **No rubbing**: erasing didn't work for you.
3. **Drawings don't stick.** You moved an object or your hand in front of a still laptop.
4. **Expert drawings didn't reach the technician page.** You checked the technician page afterwards.

You also asked me to review every earlier plan, mark what's stale, and write one plan in phases with checks, so we build one phase at a time. The hard rules stay: the hand outline (21 points) and sticky drawings stay, it must stay smooth at a high frame rate, and nothing is pushed until you review it.

### What the code shows (read on 2026-11-21)

| What you saw | Cause found in the code | How sure |
|---|---|---|
| Doesn't stick when an object moves | The tracker is built for a **moving camera over a still scene** (a phone moving around an engine). Each drawing's anchor covers at least half the picture (`MIN_ANCHOR_SIDE = 0.5`, `web/lib/ar/anchor-core.ts:49`). When only an object moves, the still background has more matching points, so the tracker follows the background and the drawing stays put. The hand area is ignored on purpose. | Confirmed from code; matches your test |
| Dotted line | Three possible causes. **(a)** A drawing whose anchor is lost is drawn *dashed and faded* on purpose (`web/lib/annotations.ts:141-145`); a hand in front makes that likely. **(b)** The stroke keeps ending and restarting: one missed hand frame ends it when hands update at 11 a second or fewer (`GONE_MS = 90`, `web/lib/ar/hands.ts:47,91`), and a late result resets the gesture (`web/lib/ar/use-hands.ts:47-51`, 300 ms). **(c)** Few points per second, because hands only get a frame after the tracker finishes it (`web/components/call/stage.tsx:146-151`). | Each is real in the code; Phase 1 shows which one you hit |
| No rubbing | Rubbing first needs an open palm **held still for 0.6 s** (`hands.ts:126-139`), and nothing on screen says so. You chose: **open palm rubs at once.** | Confirmed |
| Expert drawing missing on the technician page | The route (expert → server → technician, `use-call.ts:255`, `realtime.py:266-313`) looks sound and passes the automated test. But that test only ran on a **webpack production build in Chromium**, never on `next dev` (Turbopack) or Brave, which is what you used. | Not known yet; Phase 1 reproduces it |
| (worth testing) | Brave's fingerprint protection can slightly change pixels read from a canvas; the tracker and the hand model both read them. | To be tested, not assumed |

Ruled out: Turbopack *does* build both workers correctly (`.next/dev` output read). The security policy allows the `data:` URLs used for anchors (live header checked). The socket worked, because your call (session 1) connected and ended normally.

### Review of the earlier plans

| Document | State today | Stale parts | Action (Phase 0) |
|---|---|---|---|
| `docs/REFURBISH_PLAN.md` (the "refurbished" plan) | **Mostly done**: milestones M0–M5 built, M6 part-done. Not unexecuted. | §1 "hand gestures parked"; §6 "Later" list (gestures and sticky drawings are now the core); §7.1 "Three.js stays"; §7.2 folder layout (no `routers/`, `migrations/`, `legacy/`); §8 "hand model parked"; §10 "No AI" search that includes MediaPipe | Keep as history. Add a banner at the top listing the superseded sections and pointing to `docs/PLAN.md` |
| `docs/AR_CORE_PLAN.md` | Stages 0–2 built; Stage 3 (real-device tuning) waiting; Stage 4 (3D) not started | §6 gesture table (palm-hold undo, wave to clear); §7 "outline replaced by a cursor" (the outline is back); Stage 0 phone clips | Same banner. §15–16 stay as the record of what was built |
| `docs/DEPLOYMENT.md` | Current; never tried on a host | none | Keep |
| `STATUS.md` | Source of truth | "AR works" rests only on generated-camera tests | Add today's findings; link `docs/PLAN.md` in §8 |
| `.playwright-mcp/` (repo root) | Leftover browser-tool files, ignored by git | — | Delete |

## Progress (updated 2026-11-21)

| Phase | State | Notes |
|---|---|---|
| 0. Tidy the docs | **Done** | This file, banners on the two older plans, `.playwright-mcp/` deleted, STATUS updated |
| 1. Reproduce and measure | **Done, one step waits on the owner** | `?debug=ar` panel and `window.arguideStats`; e2e checks the expert's arrow reaches the technician (14 to 54 ms, solid for 3 s) and passes on the webpack build, `next dev` and Brave, normal and synthetic-hand. The owner's 10-minute session in Brave (step 4) has **not** happened yet |
| 2. Expert drawings reach the technician | **Not started: waiting for the owner's session** | The symptom does not reproduce with generated clips, so no fix is made without a confirmed cause. `holdLost` (Phase 4) already keeps a freshly received drawing solid for 0.5 s |
| 3. Gestures: fast, unbroken, smooth; rub at once | **Done** | See "Where the build differs" below |
| 4. Sticking, the accuracy path | **Done** | See "Where the build differs" below |
| 5. Wrap up | **Partly** | Docs, README, AGENTS updated; servers left running for review; commit question open |

### Added after the owner's screenshot (2026-11-21, later)

The owner sent a real frame from their dark room: the dashed lines were drawings the tracker could not hold (too few points), and the dashed-versus-solid look was unexplained. Added, each test-first: brightness- and noise-aware corner cut-off (lit pictures unchanged); "fixed" state for drawings with nothing to hold on to; plain-words messages on both screens; the Hands button names what is seen; an open hand is also recognised from the finger joints. Details and the open items (builds and production e2e not re-run after this; one unresolved Brave e2e failure) are in `STATUS.md` §3, §6, §7, §8 and the session log.

### Where the build differs from the plan

| Plan said | Built | Why |
|---|---|---|
| Phase 1: Brave check in a normal e2e | e2e must run against the Python server in **normal** login mode | In `DEV_NO_LOGIN` mode the test's technician becomes the expert |
| Phase 3.6: GPU delegate if hands < 24/s | Not built | Measured 24 to 31 hand results a second (about 20 ms) on this Mac |
| Phase 3.5: throttle the fingertip pointer | Not built | Hand results are at most about 30 a second, below the screen rate |
| Phase 3.2: placements by nearest time in `quality.ts` | Built as planned (`nearest`) | — |
| Phase 4.1: local features first, else the whole anchor area | Local first, **widened step by step**, then the whole area; plus a **photometric check of every placement** | Unit tests showed a small drawing area has too few corners, and that followed points can agree and still be wrong (the tracker locked onto the still background after a small object jumped) |
| Phase 4.3: size up when keeping up | Size ladder 480 / 640 / 960; rises on average tracker time at most 12 ms, falls under 24 pictures a second, and a size that was too slow is never tried again | Keeps the 640-px behaviour on slow phones |
| (not in plan) | Server validates the anchor's new `focus` box like `exclude` | Anything from the other side of the call is checked before OpenCV sees it |

## How we work

- One phase at a time. Each phase ends with its checks plus a short review by you in Brave, and the next phase starts on your "go".
- Bugs are fixed test-first: a failing test, then the fix, then all checks.
- No commit unless you ask. No push. `ArGuide/` is untouched.

---

## Phase 0: tidy the docs (small)

1. Save this plan in the repo as `docs/PLAN.md` (the single "what's next" plan).
2. Add the banners above to `docs/REFURBISH_PLAN.md` and `docs/AR_CORE_PLAN.md`. Don't rewrite them; they are history.
3. `STATUS.md`: today's test findings, the current server state, §8 pointing to `docs/PLAN.md`, a session-log row.
4. Delete `.playwright-mcp/`.

**Check:** links resolve; no secrets or personal details in the docs.

## Phase 1: reproduce and measure (no behaviour changes)

1. **AR debug panel**, shown only with `?debug=ar` on either call page. It shows:
   - tracker pictures per second, time per picture and analysis size
   - hand results per second, time per result and CPU/GPU
   - the current hand gesture, its score and the pinch ratio
   - every drawing: who drew it, locked / searching / not anchored, and whether it's on screen
   - strokes started and ended

   Fed by one small `stats` object updated in `web/lib/ar/use-anchors.ts` and `use-hands.ts`. New file `web/components/call/ar-debug.tsx`.
2. **New e2e check** (`web/e2e/call.mjs`): the expert draws while the technician page is visible. The expert's colour must appear solid and on screen on the technician canvas within 1 s, and stay on screen while the clip moves.
3. **Run the two-browser test in three setups**, each normal and with `E2E_FAKE_HAND=1`:
   - (a) webpack production build in Chromium (the old baseline)
   - (b) `next dev` (Turbopack), via `BASE_URL`
   - (c) **Brave** (`CHROME_PATH="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"`)

   Record pass or fail for each.
4. **Your 10-minute session** in Brave with the webcam and the debug panel, with the two pages in two windows side by side. I'll give you the exact steps:
   - pinch-draw 3 strokes
   - hold an open palm over a drawing
   - the expert draws while you watch the technician page
   - move the laptop slowly, then move an object instead
   - screenshot the panel each time
5. Write each symptom's confirmed cause into `STATUS.md`.

**Gate:** every symptom has a confirmed cause before Phases 2–4 change anything for it. If a cause isn't one listed above, I report it and adjust the phase before building.

## Phase 2: expert drawings reach the technician (fix depends on Phase 1)

| If Phase 1 shows… | Fix |
|---|---|
| It fails only on `next dev` | Find the Turbopack difference and fix it. If it's a bundler limit, make `dev` use `next dev --webpack` and note it in `README.md` |
| It arrives but is faded, dashed or off-screen on the technician page (tracker can't find the expert's anchor) | Show received drawings solid at their drawn place until the first lock; tracker work in Phase 4 |
| It fails only in Brave | Pin down which Brave protection causes it; handle it or tell the user on screen |

**Check:** the new e2e check passes in all three setups; you watch an expert drawing appear on the technician page.

## Phase 3: gestures that are fast, unbroken and smooth; rub at once (you chose this)

Tests first, in `web/lib/ar/hands.test.ts`. Existing palm-hold tests are replaced:
- An open palm that moves erases at once, with no hold.
- One misread "open palm" frame doesn't erase (it needs 2 frames in a row).
- One missed hand frame in the middle of a pinch keeps the line (the hand counts as gone only after ≥ 3 missed frames *and* ≥ 90 ms).
- A pinch change needs 2 frames in a row.
- A late hand result is skipped; it isn't treated as "hand gone".

Changes:

1. `web/lib/ar/hands.ts`:
   - Remove the palm hold, its timeout and the armed/expired state, so an open palm seen on 2 frames rubs.
   - Count frames, not only milliseconds, for pinch and gone.
2. Run hands **beside** the tracker, not after it:
   - `web/lib/ar/use-hands.ts` gets its own `requestVideoFrameCallback` loop. This restores the first version's pattern, which is in the 2026-11-16 transcript.
   - Remove the `onTrackedFrame` chain.
   - Points stay accurate on a moving camera: `use-anchors.ts` keeps the last ~10 placements by capture time, and the hand uses the nearest one. The helper is pure, in `web/lib/ar/quality.ts`, with a test.
   - `ponytail:` nearest tracked frame; error ≤ one tracker interval of camera motion.
3. `web/components/call/stage.tsx`: `requestDraw()`, at most once per animation frame, called on every hand result. The outline and cursor then move at the hand's rate, not the tracker's. Picture and drawings still come from the same moment.
4. `web/lib/annotations.ts`: pen strokes are **drawn as smooth curves** through the midpoints of their points. This is display only; stored points are unchanged. Add a test in `annotations.test.ts`.
5. Tech page:
   - Send the fingertip pointer at most once per animation frame (it's unthrottled today).
   - Show a "Rubbing out" banner while erasing.
6. **Graphics chip for MediaPipe, only if Phase 1 shows fewer than 24 hand results a second** in Brave on this Mac. `hands.worker.ts` tries `delegate: "GPU"` with an `OffscreenCanvas` (supported by tasks-vision 1.2.3). It falls back to the CPU if setup fails or the first 5 results take more than 50 ms on average.

**Check:**
- Unit tests pass.
- The fake-hand e2e (updated: no hold wait) passes in all three setups.
- With the debug panel, hand results per second are not capped by the tracker.
- You: 5 pinch strokes give 5 unbroken, smooth lines; an open palm rubs out at once; the outline keeps up with your hand.

## Phase 4: sticking, the accuracy path

Tests first, in `web/lib/ar/anchor-core.test.ts`:
- Camera still, the textured object under a drawing slides and turns: the drawing follows the object (average error ≤ 2 px).
- Camera moves, scene still: all existing tests still pass.
- A drawing on the background next to a moving object stays on the background.
- An anchor covered for ≤ 0.5 s stays solid ("holding"), then locks again.

Changes:

1. `anchor-core.ts`, **local first**:
   - Work out the motion from points inside the drawing's own footprint (plus a margin) when there are at least `MIN_INLIERS` of them. Otherwise use the whole anchor area, as today.
   - The footprint comes from `bounds(shape.points)`, sent with `finish` and `add` (`anchor.worker.ts`, `use-anchors.ts`).
2. **Grace before dashed:** a drawing lost for under 0.5 s keeps its last place, solid. Only after that is it drawn faded and dashed.
3. **More detail when the computer keeps up:** `quality.ts` raises the analysis size from 640 to 960 px after 3 s at ≥ 40 pictures a second, and drops back with the existing slow rule. Test in `quality.test.ts`.
4. A second generated clip, `web/e2e/make-clip.mjs`: a textured object moving over a still background, with an e2e check that a box drawn on it follows it.

**Check:**
- Unit tests and both clips pass.
- You: draw on a book and move the book, and the drawing follows. Move the laptop, and drawings stay on their spots.

Limits that stay:
- Drawings never stick to *hands* (by design).
- Strongly 3D objects turned far can slide a little (real 3D is a separate decision).
- Real phones remain unverified.

## Phase 5: wrap up

- Run every check below.
- Update `STATUS.md`, the progress ticks in `docs/PLAN.md`, `README.md` (if the dev command changed) and the checks list in `AGENTS.md` (add the `next dev` and Brave e2e runs).
- Stop the servers.
- Ask you whether to commit.

---

## Files

| File | Phases |
|---|---|
| `docs/PLAN.md` (new), `docs/REFURBISH_PLAN.md`, `docs/AR_CORE_PLAN.md`, `STATUS.md`, `AGENTS.md`, `README.md` | 0, 5 |
| `web/components/call/ar-debug.tsx` (new), `web/e2e/call.mjs`, `web/e2e/make-clip.mjs` | 1, 2, 4 |
| `web/lib/ar/hands.ts`, `use-hands.ts`, `hands.worker.ts`, `hands.test.ts` | 3 |
| `web/lib/ar/use-anchors.ts`, `quality.ts`, `quality.test.ts` | 1, 3, 4 |
| `web/components/call/stage.tsx`, `web/app/(app)/tech/session/[id]/page.tsx`, `web/lib/annotations.ts`, `annotations.test.ts` | 3 |
| `web/lib/ar/anchor-core.ts`, `anchor.worker.ts`, `anchor-core.test.ts` | 4 |

Reused, not rewritten:
- From `hands.ts`: `createHands`, `handConnections`, `handBox`
- From `erase.ts`: `eraseChanges`
- From `anchor-core.ts`: `createTracker`, `plausible`, `fit`, `anchorBox`
- From `quality.ts`: `trackingQuality`
- From `annotations.ts`: `drawShapes`, `bounds`
- The `sendSoon` once-per-frame pattern in `stage.tsx`
- The e2e fake-hand worker hook, `CHROME_PATH` and `BASE_URL`

## Verification

| Check | Command | Pass mark |
|---|---|---|
| Server tests | `npm test` (repo root) | All pass |
| AR unit tests | `cd web && npm test` | All pass, including the new tests in each phase |
| Types and build | `cd web && npx tsc --noEmit && npx next build --webpack` (and plain `next build` if the port permission allows) | Clean |
| Two-browser call, 3 setups | `npm run e2e` against the production build; `BASE_URL=http://127.0.0.1:3000` against `next dev`; `CHROME_PATH=…Brave…`. Each also with `E2E_FAKE_HAND=1` | All pass, including "expert drawing on technician screen" and "follows a moving object" |
| Speed (debug panel, this Mac, Brave) | `?debug=ar` | Tracker ≥ 24/s; hands ≥ 24/s and not capped by the tracker |
| Your review in Brave with the webcam (each phase) | Steps given at the end of each phase | Expert drawings appear; 5 pinches give 5 unbroken smooth lines; an open palm rubs at once; drawings follow a moved book and stay put when the laptop moves |

Real Android or iPhone and hosted testing stay out of scope (your decision, 2026-11-16). They won't be claimed.
