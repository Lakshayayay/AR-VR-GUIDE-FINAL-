# Plan: shrinking "checklist done" bar + thumbs-down to clear all

## Context

Seen by the owner on the technician's call screen (screenshot, 2026-11-28):

1. When every checklist step has an answer, `StepCard` (`web/components/work.tsx:113`) shows a full-width bar,
   "All 7 steps have a result. The expert will sign off." Unlike the step card, it has **no Hide link**, so it
   covers the video for the rest of the call.
2. The technician is meant to be hands-free (phone on the chest), but **Clear all** is only a button.

Owner's decisions (AskUserQuestion, 2026-11-28):

| Question | Choice |
|---|---|
| Done bar | Shrinks by itself after ~4 s to a small label; tap to reopen. The sign-off stamp shows briefly, then shrinks again |
| Clear-all gesture | **Thumbs down, held 1 s**: a warning beep and buzz when the hold starts, cancelled if the hand drops early |
| Branch | Commit the password removal first as it is, then a new branch for this work |

Why the gesture must be strict: `call.clear()` (`web/components/call/use-call.ts:349`) and the server
(`backend/app/realtime.py:309`) wipe **every** drawing, the expert's too, and it cannot be undone. The old
"wave to clear" fired by accident (`docs/history/AR_CORE_PLAN.md:22`). An open palm now rubs out drawings, and
a thumbs-up was ruled out (`AR_CORE_PLAN.md:49`). A missed clear is harmless; a wrong one is not, so only a
**confident** `Thumb_Down` label counts (no landmark fallback, unlike `isOpenHand`).

Not part of this change: the round "N" badge at the bottom left is Next.js's dev-only indicator and does not
appear in the real app.

## Step 0: git (owner chose this)

1. On `change/remove-passwords`, commit everything as it is now (password removal + STATUS notes), message
   `feat(auth): remove passwords; pick a person instead (local use only)`. No push.
2. `git switch -c feature/hands-free-clear`.

## Step 1: the done bar shrinks by itself

`web/app/(app)/tech/session/[id]/page.tsx`
- `const allDone = hasSteps && session!.checklist!.steps.every((_, i) => call.steps[i]);`
- Effect on `[allDone, !!call.signedOff]`: when `allDone`, `setStepsOpen(true)`, then after `DONE_SHOW_MS = 4000`
  `setStepsOpen(false)` (clear the timer on cleanup). This also covers rejoining a finished call.
- Collapsed button (existing `!stepsOpen` branch, line ~235): label `allDone ? (call.signedOff ? "Signed off" :
  "Checklist done, waiting for sign-off") : "Show checklist step"`; add `min-h-14` (technician buttons ≥ 56 px,
  STATUS §5). Still compact, not full width.

`web/components/work.tsx` `StepCard`: render the same Hide link in the finished state (and with the stamp), so a
card reopened by tapping can be hidden again.

## Step 2: thumbs-down held 1 s clears all

`web/lib/ar/hands.ts` (pure logic, reuse its frame-counting pattern)
- Header list: `thumbs down, held 1 s -> "clear-hold", then "clear" (or "clear-cancel" if let go early)`.
- `HandEvent` gains `{ type: "clear-hold" } | { type: "clear" } | { type: "clear-cancel" }`.
- Knobs: `CLEAR_GESTURE = "Thumb_Down"`, `CLEAR_SCORE = 0.7`, `CLEAR_HOLD_MS = 1000`,
  `CLEAR_HOLD_FRAMES = 6` (a slow phone cannot clear on two pictures), `CLEAR_GRACE_FRAMES = 2`.
- In `update`, after the pinch block and **before** the rubbing block (it returns early):
  `down = !pinched && gesture === CLEAR_GESTURE && score >= CLEAR_SCORE`.
  On `down`: count frames, note the start time at frame 1, emit `clear-hold` at `CONFIRM_FRAMES`, emit `clear`
  once frames ≥ `CLEAR_HOLD_FRAMES` and `ms - start ≥ CLEAR_HOLD_MS`, then set `cleared` (fires once per hold).
  Otherwise, after `CLEAR_GRACE_FRAMES` misses: emit `clear-cancel` if `clear-hold` was sent and it has not fired,
  and reset (letting go re-arms it).
- In the hand-gone branch: same cancel and reset.

`web/lib/ar/use-hands.ts`: add `{ type: "clear-cancel" }` to the teardown events (hands off or picture frozen).

`web/app/(app)/tech/session/[id]/page.tsx` (mirror the `rubbing` ref + `eraseReady` state pattern)
- `clearArmed` ref + `clearReady` state.
- `clear-hold`: only if `call.shapes.length`: arm, `cue("warning")`, `navigator.vibrate?.(80)`.
- `clear`: if armed and shapes exist: `call.clear()`, `cue("clear")`, `navigator.vibrate?.([30, 60, 30, 60, 30])`,
  `toast("All drawings cleared.")`; disarm.
- `clear-cancel`: disarm.
- Banner in the status stack: `Keep holding to clear all drawings…` (`bg-caution text-ink font-bold`).
- `handMode` shows "Thumbs down" while armed. The existing "no shapes left" effect also disarms.

`web/components/call/use-call.ts` `"ann:clear"` handler: `toast("All drawings were cleared.")`, so the expert
knows why their drawings vanished. One line, reuses the existing `toast`.

Reuse: `cue` kinds `warning` and `clear` already exist (`web/lib/ring.ts:30`); `call.clear()`; `CONFIRM_FRAMES`.
No new package, no server change.

## Step 3: tests and docs

- `web/lib/ar/hands.test.ts` (reuse the `hand()` and `run()` helpers; `hand(tip, 1.5, 0.12, "Thumb_Down")`):
  1. 1.5 s held → one `clear-hold`, one `clear`, no cancel.
  2. 0.5 s held, then a normal hand → `clear-hold` + `clear-cancel`, no `clear`; the hand leaving mid-hold also cancels.
  3. Held 3 s → one `clear`; let go and hold again → a second `clear`.
  4. A one-picture blip, a score-0.5 thumbs-down, or a `Thumb_Down` label while pinching → nothing.
  5. Pictures 600 ms apart (slow phone) → no `clear` after 3 pictures, despite 1.2 s.
- `web/e2e/call.mjs`: with `E2E_FAKE_HAND`, replace the expert's final "Clear all" click (line ~376) with a
  synthetic thumbs-down (`gesture: "Thumb_Down", score: 0.95`). Check the banner on the technician's side, the
  "All drawings were cleared." toast on the expert's side, and that the technician's Clear all button is gone.
  Without `E2E_FAKE_HAND` the click stays. (Clearing earlier would break the later rubbing check, which needs
  the expert's box.)
- `STATUS.md`: AR row ("Clear all is a button or a thumbs-down held 1 s"), §5 owner decisions, "not yet
  tested" (a real thumbs-down on a real hand), session log row. README and AGENTS fake-hand lines: add
  "thumbs-down clears".

## Verification

1. `cd web && npm test` (new hand tests), `npx tsc --noEmit`; `npm test` at the repo root (server, unchanged).
2. e2e on throwaway data, leaving the owner's review servers on 3000/8000 alone:
   Python on `127.0.0.1:8001` with `DATA_DIR` in the scratchpad, people `ravi` and `mehta`;
   `BACKEND_URL=http://127.0.0.1:8001 npx next build --webpack`; `npx next start -H 127.0.0.1 -p 3200`;
   `BASE_URL=http://127.0.0.1:3200 CHROME_PATH=<cached Chrome for Testing> npm run e2e`, plain and with
   `E2E_FAKE_HAND=1`. Stop the servers and delete that data afterwards.
3. Owner on http://localhost:3000 with a real webcam: answer every step → the bar shrinks after ~4 s, and the
   stamp shows briefly on sign-off; thumbs down for 1 s → beep, banner, all drawings gone on both tabs;
   a quick thumbs-down → beep, then nothing cleared.
4. Report honestly: a real hand's thumbs-down is tested only by the owner's webcam, not by phones.
