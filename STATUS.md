# ArGuide status

**Last updated:** 2026-11-15 · **Branch:** `refurbish/nextjs-python` · **Last commit:** `599369b` (tag `pre-refactor`)

Read this first in every session. Rules for keeping it current are in [`AGENTS.md`](AGENTS.md). The design and its reasoning are in [`docs/REFURBISH_PLAN.md`](docs/REFURBISH_PLAN.md).

---

## 1. In one paragraph

ArGuide is live remote help for aircraft maintenance. A technician points a phone camera at the job. A remote expert sees it, draws on it, freezes the picture, walks through a checklist and signs it off, and the call is saved as a printable report. The old prototype (`ArGuide/`: Node server, two Vite/React apps, a Gemini "AI co-pilot") is being replaced by a new stack: **`web/` (Next.js 16)** and **`backend/` (Python, FastAPI + python-socketio)**. Milestones M0 to M5 of the plan are built and tested. **There is no AI in this phase, by the owner's decision.** The project most likely targets HAL's iDEX DRISHTI Challenge 9 (Do-228 AR remote assistance). That's inferred from the code and **not confirmed by the owner**.

## 2. Where things stand

| Milestone (plan §9) | State |
|---|---|
| M0 safety net | Done. Old work committed as `599369b`, tagged `pre-refactor`. Plan and competitor screenshots in `docs/` |
| M1 Python server | Done (built straight to the signed-in protocol, see plan §13) |
| M2 Next.js shell and design system | Done |
| M3 live call in Next.js | Done |
| M4 accounts and real data | Done |
| M5 P1 features | Done, except the QR code (a "Copy link" button exists) |
| M6 speed, polish, release | **Not started.** See §8 |

**Git:** all refurbish work is committed on `refurbish/nextjs-python` and pushed to `origin` (GitHub, **public repo**), along with the `pre-refactor` tag. `main` on GitHub is unchanged; nothing has been merged. The competitor screenshots (`docs/research/screenshots/*.png`) are git-ignored and exist only on the owner's Mac, because they are other companies' pages and the repo is public. Commit and push only when the owner asks.

### Features that work (verified)

| Area | Feature |
|---|---|
| Accounts | Sign-in (cookie), three roles: technician, expert, admin. Admin adds people, changes roles, removes access, resets passwords |
| Calling | Technician starts a call (aircraft + optional checklist). Experts who are marked "Available" get a ringing dialog. Only one expert can answer. An unanswered call becomes "missed" after 45 s on the phone (server also expires after 60 s). Technician can copy a link for an expert |
| Live call | Video and voice (technician sends video and audio, expert sends audio). Drawing: arrow, circle, box, pen, text, 4 expert colours. The technician draws in green. Undo (own shapes), clear all, pointer, freeze/resume, mute, sound, camera flip, torch (where supported), screen kept awake. Connection bars and the expert's numbers are measured (delay, frames, size, speed, loss) |
| Work | Checklist step by step (technician) or full list (expert), "problem" needs a note, expert sign-off when every step has a result, inspector-style **SIGNED OFF stamp** on both sides. Chat, notes, photos (video frame plus drawings), recording only after the technician allows it |
| Records | Sessions list with search (aircraft, names, checklist, `SES-` number) and filters (status, period). Printable report (facts, checklist with stamp, photos, recording, notes, timeline). Real 7-day numbers on the expert's Calls page. Checklist editor |
| Robustness | Each call has its own private room. Rejoining restores drawings and freeze. A call left with nobody connected for 2 minutes is ended automatically. Replies to an outdated video offer are ignored |

### Checks (all passing on 2026-11-15)

| Check | Command | Result |
|---|---|---|
| Server tests | `npm test` (from repo root) | 5 of 5: sign-in rules, privacy between calls, whole call, call left open is ended, missed call |
| Two-browser call, fake cameras | `npm run e2e` (both servers running) | Passes against dev and production builds |
| Type check | `cd web && npx tsc --noEmit` | Clean |
| Production build | `cd web && npx next build` | Clean, no warnings |
| Contrast | (one-off script) | Every text colour pair ≥ 4.5:1 |
| No AI in new code | `grep -rniE "gemini\|anthropic\|mediapipe\|openai\|ai_alert" web/app web/components web/lib backend/app` | Only a comment naming where the checklists came from |

**Not yet tested:** a real phone, mobile data or strict networks (no relay server yet), Safari/iPhone, Lighthouse speed.

## 3. How to run

```bash
npm run setup                                        # once: uv sync + npm install
cd backend && uv run python -m app.cli create-user <username> "<Full Name>" <technician|expert|admin>
npm run dev:api                                      # Python on :8000 (data in backend/data/, git-ignored)
npm run dev:web                                      # Next.js on :3000
```

**Test mode without sign-in** (for trying a call quickly; the owner found login confusing while reviewing):

```bash
cd backend && DEV_NO_LOGIN=true uv run uvicorn app.main:app --port 8000
# then open two tabs:  http://localhost:3000/expert?as=<expert username>   and   http://localhost:3000/tech?as=<technician username>
```

The tab remembers who it is (sessionStorage), so two tabs in one browser can be two people. Requests without `?as=` act as the first expert. This mode is refused when `COOKIE_SECURE=true`. Never enable it on a hosted site.

**Phone on the same Wi-Fi:** `cd web && npm run dev:phone` (https, self-signed; the camera needs https).

**End-to-end test:** needs accounts `ravi` (technician, "Ravi Kumar") and `mehta` (expert, "Dr. Mehta") with password `demo-pass-1`. If Playwright's own browser isn't installed, run `npx playwright install chromium` or set `CHROME_PATH`. On the owner's Mac a cached Chromium exists at `~/Library/Caches/ms-playwright/chromium-1243/...`; Playwright 1.65 expects build 1255.

**State of servers right now:** at the end of the 2026-11-15 session, both servers were running in test mode against a throwaway database in the agent's temporary scratch folder, with demo accounts `ravi`, `mehta`, `asha` (admin), all with password `demo-pass-1`. That folder is not kept, so a new session should create its own database and accounts.

## 4. Map of the code

| Path | What it does |
|---|---|
| `backend/app/main.py` | Starts FastAPI and Socket.IO together. On start, watches calls still marked active |
| `backend/app/config.py` | All settings from environment variables (see `backend/.env.example`). Generates `data/secret.key` if `SECRET_KEY` is unset |
| `backend/app/db.py` | SQLAlchemy tables, JSON shapes sent to the browser, the 3 seed checklists, `init_db()` (create_all, no migrations yet) |
| `backend/app/auth.py` | argon2 passwords, JWT cookie `arguide_session` (12 h), short socket token (2 min), role checks, login throttle (5 tries a minute), `DEV_NO_LOGIN` bypass |
| `backend/app/api.py` | REST: checklists, people, sessions, file upload/download, stats, ICE config |
| `backend/app/realtime.py` | Live connection: call life cycle, relays, checklist, sign-off, chat, abandoned-call timer |
| `backend/app/cli.py` | `create-user` command |
| `backend/tests/test_call_flow.py` | Starts a real server; runs whole calls with 3 to 4 people |
| `web/app/(auth)/login` | Sign-in page |
| `web/app/(app)/layout.tsx` → `components/app-provider.tsx` | Loads the signed-in user, opens the live connection, expert availability, incoming-call dialog and ring, toasts |
| `web/app/(app)/(nav)/…` | Pages with the top bar: `tech`, `expert`, `expert/session/[id]` (console), `sessions`, `sessions/[id]` (report), `checklists`, `admin/users` |
| `web/app/(app)/tech/session/[id]` | Technician's full-screen phone call (no top bar) |
| `web/components/call/use-call.ts` | **All live-call logic** shared by both sides (join, WebRTC, drawings, steps, chat, photo, recording) |
| `web/components/call/stage.tsx` | Video + drawing canvas (pointer input, fractions of the picture), signal bars |
| `web/components/work.tsx` | Stamp, checklist panel, step card, chat/notes, photos and recordings |
| `web/components/ui.tsx`, `top-nav.tsx` | Buttons, fields, native `<dialog>`; top bar |
| `web/lib/` | `api.ts` (fetch + errors + test-mode header), `webrtc.ts` (peer + quality), `annotations.ts` (shapes, drawing, photo capture), `format.ts`, `ring.ts` (ringtone made with Web Audio), `types.ts` |
| `web/e2e/call.mjs` | Two-browser end-to-end test |
| `web/AGENTS.md` | Written by Next.js itself: read the bundled Next 16 docs before changing Next-specific code |
| `ArGuide/` | Old prototype. Untouched; still runs with `npm run legacy:*`. Delete only after the owner accepts the new app (M6) |

### Live messages (Socket.IO, all need a signed-in socket token)

| From | Event | Purpose |
|---|---|---|
| Expert | `expert:available {on}` | Join or leave the `experts` room; server replies `queue:update` |
| Technician | `call:start {aircraft, checklistId}` → ack `{ok, session}` | Creates a waiting session; experts get `queue:update` |
| Expert | `call:accept {sessionId}` → ack | Only the first succeeds; room gets `call:accepted` |
| Either | `session:join {sessionId}` → ack `{session, steps, events, shapes, frozen, peers}` | Joins the private room `session:<id>`; others get `peer:joined` |
| Either | `session:leave`, `call:end {sessionId, reason?}` | Leave; end (waiting → cancelled or missed, active → ended); room gets `call:ended` |
| Either | `signal {sessionId, data:{id, type, …}}` | WebRTC set-up, relayed. `id` = offer id; the technician always makes the offer |
| Either | `ann:put {shape}`, `ann:remove {id}`, `ann:clear`, `pointer`, `freeze` | Relayed; drawings and freeze are also kept in memory for rejoin |
| Either | `step:set {step, status, note}`, `msg {kind: chat or note, text}` → ack | Saved; room gets `step:update` / `event:new` |
| Expert | `signoff` → ack | Saved; room gets `signoff:update` |
| Both | `record:request` → `record:answer {allowed}` → `record:state {on}` | Consent before recording |

REST endpoints (all under `/api`, docs at `/api/docs` while running): `auth/login|logout|me|socket-token`, `config`, `checklists` (GET/POST/PUT), `users` (admin), `sessions` (list with `q`, `status`, `days`), `sessions/{id}`, `sessions/{id}/files` (photo/recording upload), `files/{event_id}`, `stats`.

Tables: `users`, `sessions` (stores a **copy** of checklist steps), `session_events` (chat, note, photo, recording), `step_results`, `checklists`.

## 5. Decisions that stand (do not undo without asking the owner)

| Decision | Detail |
|---|---|
| No AI in this phase | No Gemini, no hand tracking, no defect detection until the owner accepts the refurbished stack. Parked items are listed in plan §6 "Later" |
| Python backend, Next.js frontend | Owner's requirement |
| Closed-network ready | Nothing may call outside services at runtime (fonts bundled by `next/font`, ringtone generated, no CDNs). Only exception: the default STUN server in `ICE_SERVERS`, which can be overridden |
| "Flight line" design (owner chose it) | Live-call screens dark (`live` class, `hangar` #18222b); everything else light (`paper` #f7f9fa). Status colours only for status (warn, caution, normal, advisory). Typeface B612 / B612 Mono. The inspector stamp is the one bold element. Technician buttons ≥ 56 px with a word under every icon. Sentence case; buttons say what happens. Tokens are in `web/app/globals.css` |
| Few dependencies | Web runtime: next, react, react-dom, socket.io-client, lucide-react. Native HTML instead of UI libraries. Keep it that way unless there's a real need |
| Same-origin API | Browser talks only to Next.js; `next.config.ts` rewrites `/api` and `/socket.io/` to Python (cookie stays first-party). For hosts that can't pass WebSockets (Vercel), set `NEXT_PUBLIC_SOCKET_URL` to the Python server; the socket token handles sign-in |

## 6. Lessons learned (save the next agent the time)

- **Next.js 16 is newer than most training data.** Read `web/node_modules/next/dist/docs/` before Next-specific changes. `params` in pages are read with `useParams()` (client pages).
- **TypeScript is pinned to 5.x.** `npm install typescript` pulled TS 7 (native), which Next 16's build doesn't support.
- **React dev mode runs effects twice.** Anything started in an effect must ignore the discarded run (see the `settled` / `waiters` pattern in `use-call.ts`). Two quick video offers must not cross; that's why every signal carries an offer `id`.
- **Newer Chrome makes `scrollIntoView()` return a Promise.** Never return a call's value from a `useEffect` arrow; use braces.
- **Socket.IO through Next rewrites** needs `skipTrailingSlashRedirect: true` and the `/socket.io/` rewrite with its trailing slash.
- **Dev server blocks non-localhost origins.** `allowedDevOrigins` in `next.config.ts` includes 127.0.0.1 and LAN ranges.
- **Forms with passwords use `method="post"`**, so a click before the page script loads can't put the password in the address bar.
- **python-socketio handlers:** the `disconnect` handler takes `(sid, *reason)`; `enter_room` / `leave_room` are async; use `sio.sleep` / `start_background_task` for timers.

## 7. Known limits (deliberate shortcuts; upgrade when needed)

| Shortcut | Limit | Upgrade |
|---|---|---|
| Live rooms, login throttle and drawings kept in memory in one process | One server process; drawings lost on restart | Redis + `socketio.AsyncRedisManager` |
| `create_all`, no migrations | Changing a table breaks existing databases | Add Alembic before the first change on real data |
| Sync SQLAlchemy inside async socket handlers | Fine for one site's traffic | Async engine if calls queue up |
| Uploads go through the Next.js rewrite to local disk (`backend/data/uploads`) | Long recordings are large; free hosts wipe disks | Object storage, or upload straight to Python |
| Expert sends audio only | The technician can't see the expert | Add expert video if wanted |
| No QR code, no observers, no low-bandwidth mode | — | Plan P2 |

## 8. Next steps (in order)

1. **Owner:** try a real call (test mode links above, then a phone with `npm run dev:phone`). Collect what feels wrong.
2. **Owner decision:** when the new app is accepted, merge `refurbish/nextjs-python` into `main` (for example with a pull request).
3. **M6:** relay server (coturn) and `ICE_SERVERS`; hosting (Python on Render or similar with `SECRET_KEY`, `COOKIE_SECURE=true`, `ALLOWED_ORIGINS`; Next on Vercel with `BACKEND_URL` and `NEXT_PUBLIC_SOCKET_URL`); Lighthouse speed run; Safari/iPhone check; re-capture the TeamViewer screenshot.
4. After the owner accepts: delete `ArGuide/`, add Alembic, then P2 (low-bandwidth mode, observers, one-command Docker install for closed networks).
5. Only then: the AI phase (defect detection and the rest, per plan §6 "Later").

## 9. Session log

| Date | What happened |
|---|---|
| 2026-11-15 | Inspected the old app; researched competitors; wrote the plan (`docs/REFURBISH_PLAN.md`). Owner chose: Flight line look, build now, internet hosting that stays closed-network ready. Built M0 to M5 (`backend/`, `web/`), with 5 server tests and a two-browser end-to-end test, all passing. Fixed bugs found by testing (abandoned calls, password in URL, crossing video offers, Chrome `scrollIntoView` Promise). Added `DEV_NO_LOGIN` test mode at the owner's request. Added `STATUS.md`, `AGENTS.md`, `CLAUDE.md`. At the owner's request, committed everything and pushed the branch and the `pre-refactor` tag; competitor screenshots kept local (public repo) |
