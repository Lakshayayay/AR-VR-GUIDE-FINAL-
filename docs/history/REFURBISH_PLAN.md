# ArGuide refurbish plan: new look, feature list, and move to Next.js + Python

Date: 2026-11-15. Scope: full-stack only. **No AI in this phase.**

> **History, not the current plan (2026-11-21).** Milestones M0 to M5 were built from this file; M6 is part done. What comes next is in [`STATUS.md`](../../STATUS.md); the AR and review-round plans are [`AR_CORE_PLAN.md`](AR_CORE_PLAN.md) and [`PLAN.md`](PLAN.md). The old app (`ArGuide/`) was removed and stays in git history under the tag `pre-refactor`. Parts of this file that no longer hold:
> §1 "hand gestures parked"; §6 "Later" (gestures and sticky drawings are now the core, see [`AR_CORE_PLAN.md`](AR_CORE_PLAN.md)); §7.1 "Three.js stays"; §7.2 folder layout (no `routers/`, `migrations/` or `legacy/`; the old app stays in `ArGuide/`); §8 "hand-tracking model parked"; §10 "No AI" search (MediaPipe is allowed on the device). §13 is the record of what was really built.

> This file is the design and the reasoning behind it. For where the work stands today, read [`STATUS.md`](../../STATUS.md) at the repo root.

## 1. Context

**Why this work:** ArGuide lets a technician at an aircraft point a phone camera at a problem while a remote expert watches and draws on the picture. It works as a demo, but the look is inconsistent, much of what is on screen is fake, the code is hard to change, and nothing is saved. The goal is a fast, polished, trustworthy product on a clean base (Next.js for the screens, Python for the server). AI comes back only after this is done.

**Three things that differ from the brief (please read):**

| # | Brief says | What I found | What the plan does |
|---|---|---|---|
| 1 | Project is "AirGuy" | The repo is **ArGuide** | Treats them as the same project |
| 2 | Already Python backend + Next.js frontend | Backend is **Node.js**; frontends are **two Vite + React apps**. No Python or Next.js exists yet | This is a **move** to Python + Next.js, not a tidy-up. Bigger job; the timeline reflects it |
| 3 | Capture screenshots | Plan mode is read-only, so none were saved | Section 4 lists exactly what to capture and why; capturing is step M0 |

One side effect to know about: a browser tool I tried created a stray folder `.playwright-mcp/` in the repo root (one file, untracked). M0 deletes it.

**Decisions you confirmed on 2026-11-15:**

| Question | Your answer | Effect on the plan |
|---|---|---|
| Look | "Flight line" | Section 5 stands as written |
| Pace | "I want to do a full stack build right now" | Building starts as soon as this plan is approved. Section 9 is a build order, not a calendar |
| Hosting | Internet now, closed-network ready | Nothing in the new app may depend on outside services while running; the own-server install stays in P2 |

**Calls I made (say so if you disagree):**
- Hand-gesture drawing (pinch to draw) runs on a machine-learning model (MediaPipe). Strictly that is AI, so by the brief's "no AI wins" rule it is **parked** with the other AI work, not deleted.
- The old AI service (`ArGuide/ai-copilot/`) is left untouched and simply not started. Its non-AI parts (session table, the three checklists) are carried over.
- Checklists come back as a **manual** feature (a person ticks the step). AI checking is added later.

---

## 2. What exists today (inspection, all confirmed by reading the code)

| Part | What it is, simply | Built with | State |
|---|---|---|---|
| `ArGuide/server/index.js` (126 lines) | The "switchboard": passes messages between phone and expert | Node, Express, Socket.IO | Works. No login, no database, open to any website |
| `ArGuide/expert-dashboard/` | Expert's desktop screen | Vite, React 18, Tailwind 4 | One 1,673-line file. Live call works; the other three tabs are mock-ups |
| `ArGuide/temp_ui/technician/` | Technician's phone screen | Vite, React 18, Tailwind 4 | Call works. 926-line main file |
| `ArGuide/ai-copilot/` | AI service + the only database | Node, Gemini, SQLite | Out of scope this phase |
| `ArGuide/expert-dashboard/expert/`, `AR.tsx`, `LiveSession.tsx.bak`, `server/public/` | Old copies | — | Dead code |

**Worth keeping:** the video call (WebRTC), call/accept/decline flow, drawing tools (arrow, circle, rectangle, freehand, text, 5 colours), camera flip/mute, the three checklists in `ArGuide/ai-copilot/database.js:108-163`, and the Tailwind + shadcn setup.

**Problems found (each one is fixed by this plan):**

| Problem | Where | Why it matters |
|---|---|---|
| Every call also joins one shared room, `HAL-123` | `expert-dashboard/src/app/App.tsx:7,94,356`; `AR.tsx:109` | Two calls at once would see each other's drawings |
| Laser pointer and freeze never reach the other side | Sent at `App.tsx:842,984`; listened for at `LiveSession.tsx:612,629`; `server/index.js` has no relay for either | Two visible buttons that silently do nothing |
| No login; names are hard-coded | `App.tsx:213` ("RK"), `LiveSession.tsx:223` ("Field Technician") | No record of who did what |
| Fake numbers shown as real | Analytics `App.tsx:1489-1506`; status bar `:269-274`; latency/resolution `:1162-1164,1274-1277`; annotation count is random `:124` | Destroys trust the first time someone notices |
| History is one seeded row, lost on refresh | `App.tsx:13-15` | Nothing is saved |
| Buttons that do nothing | "New Session" `:1061`; search and filters `:1423-1439`; settings never save `:1549` | Feels broken |
| Server address typed into the code, three different ones | `App.tsx:8`; `LiveSession.tsx:413`; `AR.tsx:269` | Cannot change server without editing code |
| No relay server for hard networks (STUN only, Google's) | `App.tsx:545`; `LiveSession.tsx:125` | Calls fail on strict office networks; will not work on a closed network |
| Files fetched from outside sites while running | MediaPipe `LiveSession.tsx:672`; ringtone `App.tsx:26`; fonts `AICopilotPanel.jsx:271` | Slower start; breaks without internet |
| Same drawing code copy-pasted three times | `App.tsx:429-496`; `LiveSession.tsx:486-564`; `AR.tsx:305-343` | Every fix must be made three times |
| 48 UI components × 3 copies, none imported; about 55 packages listed, 6 used | all three `package.json` files | Slow installs, confusing repo |
| Two unrelated looks | Expert: light + blue `#185FA5`. Technician: near-black + teal `#5DCAA5` | Feels like two products |
| No tests; anyone can connect | `server/index.js:8` | Unsafe to change; unsafe to expose |
| 862 lines of unsaved (uncommitted) work in 5 files | `git status` | Must be saved before anything moves |

---

## 3. Competitor analysis

"Confirmed" = read on the vendor's own page. "Vendor-stated" = a marketing claim, not independently tested. Prices are mostly unpublished; figures below are unverified.

| Product | Link | What stands out | Idea we take (our own design) |
|---|---|---|---|
| TeamViewer Assist AR / Frontline | [features](https://www.teamviewer.com/en/global/support/knowledge-base/other-products/assist-ar/features/) | Arrows that stick to real objects; each person has their own colour; "undo last" and "remove all"; recording starts only after the other side agrees; join by shared link (confirmed) | Per-person colour, undo, consent before recording, link join |
| Help Lightning | [product](https://helplightning.com/product) | Expert's hands shown over the live video; freeze, zoom, recording; photos saved to the call record; guided procedures before, during and after a call (vendor-stated) | Checklist tied to the call; snapshots saved to the session record |
| Librestream Onsight | [remote expert](https://librestream.com/platform/remote-expert/) | Works on very poor connections (claims 30 kbps), still photos instead of video, offline mode, can be installed on a company's own servers; aerospace and defence customers (vendor-stated) | Low-bandwidth mode; own-server install. Closest to our niche |
| Zoho Lens | [home](https://www.zoho.com/lens/), [pricing](https://www.zoho.com/lens/pricing.html) | Cheap, has a free plan; drawing, chat, freeze, snapshot, recording, work instructions, smart glasses (confirmed on page). Price about $8–14 per technician per month (sources disagree) | Text chat for noisy places; simple plan structure |
| SightCall | [visual support](https://sightcall.com/visual-support) | Measuring with the camera, reading text and barcodes, forms, reports, dashboards such as "fixed first time" (vendor-stated) | Session report; honest dashboards from real data |
| XMReality | [product](https://www.xmreality.com/product) | Guest opens a link in the phone browser, no app and no login; pointer, freeze, automatic recording (vendor-stated) | Join by link or QR code |
| VSight Remote | [features](https://vsight.io/visual-assistance-software/), [pricing](https://vsight.io/pricing/) | Pointer, photo mark-up, join by link/QR, offline mode, audit log, many smart glasses (vendor-stated). About $240/month (unverified) | Audit trail of who did what |
| Kognitiv Spark RemoteSpark | [news](https://www.auganix.org/?p=17869) | Built for defence: low bandwidth incl. satellite, runs with no internet at all (vendor-stated) | Proof that closed-network install is a selling point |
| Scope AR, Taqtile Manifest | [Scope AR aviation](https://scopear.com/aviation), [Taqtile](https://taqtile.com) | Step-by-step instructions shown on the aircraft (vendor-stated) | Step-by-step checklist with one step in view at a time |

**Two big names have left the field** (both confirmed dates):
- PTC Vuforia Chalk was shut down on 31 Oct 2025 ([PTC notice](https://community.ptc.com/vuforia-chalk-220/vuforia-chalk-end-of-service-notice-158324)). Users report its replacement has no drawing-on-video.
- Microsoft Dynamics 365 Remote Assist ends on 31 Dec 2026 ([Microsoft](https://learn.microsoft.com/en-us/dynamics365/mixed-reality/remote-assist/buy-remote-assist), [Directions on Microsoft](https://www.directionsonmicrosoft.com/reports/dynamics-365-retiring-guides-and-remote-assist-move-before-dec-2026/)).

**So what (the useful part):**

| Decision | Reason |
|---|---|
| **Match** the basics every product has | Login, call queue, working freeze + pointer, undo, snapshots, recording with consent, saved history, join by link. We lack all of these today |
| **Stand out** on three things | (1) Pre-flight checklist with sign-off built into the call. (2) Runs on a closed network with no internet. (3) Still usable on a bad connection. Only Librestream and Kognitiv Spark compete here, and both are expensive enterprise products |
| **Skip for now** | Camera measuring, text/barcode reading, 3D models, smart glasses, links to other business software. Costly, and not what the aircraft use case is judged on |

Other sources: [Aviation Week on remote tools in aircraft maintenance](https://aviationweek.com/mro/remote-collaboration-tools-connecting-distant-mro-teams), [Next.js 16](https://nextjs.org/blog/next-16), [python-socketio version table](https://python-socketio.readthedocs.io/en/stable/intro.html).

---

## 4. Visual references to capture (step M0)

Nothing is captured yet. Each will be saved to `docs/research/screenshots/` with the name shown. We borrow the **pattern**, never the artwork, colours, icons or wording.

| File name | Page | What to capture | Pattern we borrow |
|---|---|---|---|
| `01-teamviewer-toolbar.png` | TeamViewer Assist AR features page | The in-call toolbar with drawing tools | Tools grouped by job; undo next to clear |
| `02-helplightning-call.png` | helplightning.com/product | A live call with freeze on | How "frozen" is made obvious to both sides |
| `03-librestream-stills.png` | librestream.com/platform/remote-expert | Still-photo collaboration view | Photo mode for bad connections |
| `04-zoho-lens-tech.png` | zoho.com/lens | Technician phone view | Few, large controls over full-screen camera |
| `05-zoho-lens-plans.png` | zoho.com/lens/pricing.html | Plan table | Plain-language plan table (for later) |
| `06-xmreality-join.png` | xmreality.com/product | Link-join screen | One-tap join with no install |
| `07-sightcall-report.png` | sightcall.com/visual-support | Report or dashboard image | What a session report contains |
| `08-scopear-steps.png` | scopear.com/aviation | Step-by-step instruction view | One step in focus, progress visible |
| `09-current-expert.png`, `10-current-tech.png` | Our own app, running locally | Every screen as it is today | "Before" pictures to compare against |

Mock-up references (our own): the wireframes in section 5.

---

## 5. UI/UX redesign blueprint

### 5.1 Design idea: "Flight line"

Taken from the world the product lives in, not from other software.

| Principle | What it means on screen |
|---|---|
| **Dark cockpit** (a real aviation rule: nothing lights up when all is normal) | The screen stays quiet and grey. Colour appears only when something needs attention. A good connection shows no colour; a weak one turns amber; a lost one turns red |
| **The camera is the page** | On the phone, video fills the screen. Controls float on top and stay in the thumb's reach |
| **Gloves and sunlight** | Technician buttons at least 56 px, with a word under every icon, strong contrast, no thin grey text |
| **Records look like records** | History and reports are light and printable, like a maintenance task card |
| **One memorable thing: the inspection stamp** | Signing off a checklist places a stamp with name and time, like the inspector's stamp on a real task card. Everything else stays plain |
| **Nothing fake** | If a number is not measured, it is not shown |

### 5.2 Screens

| Address | Who | What it is |
|---|---|---|
| `/login` | Everyone | Sign in |
| `/tech` | Technician | Home: "Call an expert", recent sessions |
| `/tech/session/[id]` | Technician | Live call |
| `/expert` | Expert | Waiting calls and "you are available" switch |
| `/expert/session/[id]` | Expert | Live call console |
| `/sessions` | Both | Saved sessions with working search and filters |
| `/sessions/[id]` | Both | Session report (prints to PDF) |
| `/checklists` | Expert, admin | Checklist library |
| `/admin/users` | Admin | Add and remove people |

### 5.3 Wireframes

Technician live call (phone):
```
┌───────────────────────────┐
│ 04:12   Dr. Mehta    ▂▄▆  │  timer, expert name, signal bars
│                           │
│        CAMERA VIEW        │
│   (expert's drawings      │
│      appear here)         │
│                           │
│ ┌ Step 3 of 7 ──────────┐ │  current step only; swipe down to hide
│ │ Verify fuel line      │ │
│ │ connections           │ │
│ │ [ Done ]   [ Problem ]│ │
│ └───────────────────────┘ │
│  Mic  Light  Flip  Photo  │  56 px buttons with labels
│        [  End call  ]     │
└───────────────────────────┘
```

Expert live console (desktop):
```
┌──────────────────────────────────────────────────────────────────┐
│ ArGuide    Calls (2)   Sessions   Checklists           Available │
├──────────┬──────────────────────────────────────┬────────────────┤
│ Waiting  │                                      │ Checklist      │
│  Asha    │                                      │  ✓ 1 Visual    │
│  Bay 3   │           LIVE VIDEO                 │  ✓ 2 Fasteners │
│  0:40    │      drawings + pointer              │  ▸ 3 Fuel line │
│          │                                      │    4 Oil leaks │
│ In call  │                                      ├────────────────┤
│  Ravi K  │                                      │ Photos (3)     │
│  VT-ABC  ├──────────────────────────────────────┤ Notes          │
│  04:12   │ Arrow Circle Box Pen Text │ colours  │ Chat           │
│ [End]    │ Pointer Freeze Photo │ Undo  Clear   │                │
└──────────┴──────────────────────────────────────┴────────────────┘
```

Technician home and expert waiting screen:
```
┌───────────────────────────┐   ┌────────────────────────────────────┐
│ ArGuide          Ravi K ▾ │   │ ArGuide  Calls  Sessions    Available│
│                           │   ├────────────────────────────────────┤
│  ┌─────────────────────┐  │   │ No one is waiting.                 │
│  │   Call an expert    │  │   │ You will hear a ring when a        │
│  └─────────────────────┘  │   │ technician calls.                  │
│  Aircraft  [ VT-ABC   ▾]  │   │                                    │
│  Checklist [ Engine   ▾]  │   │ Today: 4 calls, average 11 min     │
│                           │   │ (real numbers from saved sessions) │
│  Recent sessions          │   └────────────────────────────────────┘
│  12 Nov  Engine   14 min  │
└───────────────────────────┘
```

Session report (prints on one or two pages):
```
┌──────────────────────────────────────────────────────┐
│ Session report                    SES-000142         │
│ Aircraft VT-ABC   12 Nov 2026   14 min               │
│ Technician Ravi K        Expert Dr. Mehta            │
├──────────────────────────────────────────────────────┤
│ Engine assembly check                  ╭───────────╮ │
│  1 Visual inspection   Done  10:02     │ SIGNED OFF│ │
│  2 Fastener torques    Done  10:05     │ Dr. Mehta │ │
│  3 Fuel line           Problem 10:09   │ 12 Nov    │ │
│     "Chafing near clamp" + photo       ╰───────────╯ │
├──────────────────────────────────────────────────────┤
│ Photos (3)        Notes        Timeline              │
└──────────────────────────────────────────────────────┘
```

Every screen also gets designed states for: loading, empty, error, camera permission refused, reconnecting, no expert answered.

### 5.4 Component inventory

| Group | Components |
|---|---|
| Shell | `TopNav`, `AvailabilitySwitch`, `UserMenu` |
| Call | `CallQueue`, `IncomingCallDialog`, `VideoStage`, `AnnotationLayer`, `AnnotationToolbar`, `CallControls`, `SessionTimer`, `SignalBars`, `ReconnectBanner` |
| Work | `ChecklistPanel`, `StepCard`, `SignOffStamp`, `PhotoStrip`, `NotesBox`, `ChatBox` |
| Records | `SessionTable`, `SessionFilters`, `SessionReport`, `StatTile` |
| Basics (already in the repo, copy only these) | button, input, select, switch, dialog, table, tabs, tooltip, badge, toast, from `ArGuide/expert-dashboard/src/app/components/ui/` |
| Admin | `UserTable`, `ChecklistEditor` |

### 5.5 Style guide

**Colours**

| Name | Value | Used for |
|---|---|---|
| Hangar slate | `#18222B` | Live call background |
| Panel | `#22303B` | Panels during a call |
| Paper | `#F7F9FA` | Records pages |
| Ink | `#15212B` | Text on paper |
| Rule | `#D5DCE2` | Lines and borders |
| ArGuide blue | `#185FA5` | Main action buttons (kept from today's dashboard) |
| Warning red / Caution amber / Normal green / Advisory cyan | `#E23B2E` / `#F2A900` / `#2E9E5B` / `#2AA7D8` | Status only, following the cockpit warning-light convention |
| Drawing colours | orange `#FF6A13`, yellow `#FFD60A`, pink `#FF3D9A`, green `#3DDC84`, white | Drawings on video, each with a thin dark edge so they show on any metal. Chosen from the colours of inspection lacquer used on aircraft fasteners |

All text will be checked for contrast (at least 4.5 to 1) in M2. Not yet measured.

**Type**

| Role | Typeface | Why |
|---|---|---|
| All interface text | **B612** (regular, bold) | Open-source face commissioned by Airbus for cockpit screens: made to be read fast in harsh light |
| Timers, session numbers, part numbers | **B612 Mono** | Digits stay aligned while they tick |

Sizes: 12, 14, 16, 20, 24, 32. Technician screens never go below 16. Sentence case everywhere. Fonts are bundled with the app (no outside font service). Fallback if B612 feels limiting: IBM Plex Sans.

**Shape, space, motion**

| Item | Rule |
|---|---|
| Spacing | Steps of 4 px |
| Touch size | 56 px technician, 40 px expert |
| Corners | Round = call controls. 6 px = tools and inputs. 10 px = panels. Shape tells you what kind of thing it is |
| Over video | Solid dark backing at 80%, no blur (blur is slow on cheap phones) |
| Motion | Only the incoming-call ring and 150 ms state changes. Off when the device asks for reduced motion |
| Icons | lucide (already installed), always with a word on technician screens |

**Words:** buttons say what happens ("Call an expert", "End call", "Mark step done", "Report a problem"). Errors say what went wrong and what to do ("Camera is blocked. Allow camera access in your browser settings, then try again.").

**Accessibility floor:** full keyboard use of the expert console, visible focus ring, labels on every control, status never shown by colour alone.

---

## 6. Prioritised feature list (no AI)

**P0: must work before anything else**

| # | Feature | Today |
|---|---|---|
| 1 | Sign in with three roles: technician, expert, admin | Missing |
| 2 | Real sessions: number given by the server, saved, private room per call | Shared `HAL-123` room |
| 3 | Clear call flow: call, ring, accept or decline, connected, ended; "no answer" after 45 s; auto-reconnect | Partly works, with workarounds |
| 4 | Video + two-way audio that survives strict networks (adds a relay server) | Works on easy networks only |
| 5 | Drawing tools + **undo** + clear + a colour per person | Tools exist; no undo |
| 6 | Pointer and freeze that actually sync | Broken |
| 7 | Real signal indicator (measured from the call) | Fake numbers |
| 8 | Saved history with working search and filters | One fake row |

**P1: what makes it a product**

| # | Feature |
|---|---|
| 9 | Photos: capture the frame with drawings, saved to the session |
| 10 | Manual checklists: choose one, step through, mark done or problem, sign off (uses the three existing checklists) |
| 11 | Session report page that prints to PDF |
| 12 | Notes and text chat (hangars are loud) |
| 13 | Recording, only after the technician agrees |
| 14 | Join by link or QR code |
| 15 | Honest numbers page built from saved sessions |
| 16 | Admin: manage people and edit checklists |

**P2: after the core is solid**

| # | Feature |
|---|---|
| 17 | Low-bandwidth mode (photos or audio only when the link is weak) |
| 18 | Install-to-home-screen, keep screen awake, torch |
| 19 | A second expert or observer in a call |
| 20 | One-command install on a closed network (Docker) |

**Later, with the AI phase:** defect detection, AI checklist checking, photo pre-diagnosis, predictive maintenance, hand-gesture drawing, drawings that stay stuck to the object as the camera moves, smart glasses.

---

## 7. Full-stack refactoring plan

### 7.1 Technology

| Layer | Choice | What it is, simply | Why |
|---|---|---|---|
| Screens | **Next.js 16** (App Router), React 19, TypeScript | The framework for all pages | Required by the brief. One app replaces two |
| Styling | Tailwind CSS 4 + shadcn basics | Utility styles + ready-made buttons, dialogs | Already used in the repo |
| Live messages (browser) | `socket.io-client` | Sends drawings and call signals instantly | Already used; no client rewrite |
| Server | **Python 3.14** (already installed), **FastAPI**, set up with `uv` (already installed) | Handles login, saving, and data | Required by the brief; the standard modern Python choice |
| Live messages (server) | **python-socketio 5.x** | Python version of today's switchboard | Confirmed to work with the existing browser library (v4) |
| Database | SQLite while developing, PostgreSQL when hosted (SQLAlchemy + Alembic) | Where sessions and users are saved | One setting switches between them |
| Login | Password (argon2) + signed cookie (JWT) | Admin creates accounts | No outside login service, so it also works on a closed network |
| Video | WebRTC in the browser (unchanged) + **coturn** relay | Phone and expert talk directly; relay helps on strict networks | Fixes failed calls |
| Tests | pytest (server), Playwright (two browsers with a fake camera) | Automatic checks | There are none today |

Not used: MUI, Emotion, Recharts, react-dnd, react-slick, canvas-confetti, motion, react-router, react-hook-form (all listed today, none needed). Three.js stays for now inside the one shared drawing component, loaded only on the call page.

### 7.2 Target folder layout

```
ARGuidee-main/
├── web/                         Next.js app (replaces both Vite apps)
│   ├── app/
│   │   ├── login/page.tsx
│   │   ├── tech/page.tsx                 tech/session/[id]/page.tsx
│   │   ├── expert/page.tsx               expert/session/[id]/page.tsx
│   │   ├── sessions/page.tsx             sessions/[id]/page.tsx
│   │   ├── checklists/page.tsx           admin/users/page.tsx
│   │   ├── layout.tsx   globals.css (colour and type tokens)
│   ├── components/ui/           only the basics we use
│   ├── components/call/         VideoStage, AnnotationLayer, toolbars
│   ├── components/work/         checklist, stamp, photos, notes
│   ├── lib/                     api.ts, socket.ts, webrtc.ts, annotations.ts
│   └── public/                  ringtone and other bundled files
├── backend/                     Python server (replaces server/index.js)
│   ├── app/
│   │   ├── main.py              starts FastAPI + Socket.IO together
│   │   ├── config.py            settings read from the environment
│   │   ├── db.py  models.py     database tables
│   │   ├── auth.py              passwords and cookies
│   │   ├── realtime.py          live events (port of server/index.js)
│   │   └── routers/             auth, sessions, checklists, users, stats
│   ├── migrations/              database change history
│   ├── tests/
│   └── pyproject.toml
├── docs/                        this plan + research screenshots
└── legacy/                      old code, deleted at M6
```

Database tables (five): `users`, `sessions`, `session_events` (drawings count, photos, notes, chat: one flexible table), `checklists`, `step_results`.

### 7.3 Where existing code goes

| Today | Becomes | Reused, not rewritten |
|---|---|---|
| `server/index.js:19-49, 86-120` (11 non-AI events) | `backend/app/realtime.py` | Same event names and message shapes, so the old screens keep working during the move |
| Call set-up in `App.tsx:536-590` and `LiveSession.tsx:120-160, 436-470` | `web/lib/webrtc.ts` | Logic moved as-is into one place |
| Drawing code in `App.tsx:420-500` and `LiveSession.tsx:480-600` | `web/components/call/AnnotationLayer.tsx` + `web/lib/annotations.ts` | One copy instead of three |
| Incoming-call screen `App.tsx:155-194`; ringing screen `LiveSession.tsx:821-840` | `IncomingCallDialog`, technician calling state | Flow kept, restyled |
| Toolbar `App.tsx:1182-1261`; phone controls `LiveSession.tsx:879-916` | `AnnotationToolbar`, `CallControls` | Kept, restyled |
| `ai-copilot/database.js:14-27, 108-163` | `backend/app/models.py` + first migration | Session table shape and the three checklists |
| `expert-dashboard/src/styles/theme.css` | `web/app/globals.css` | Structure kept, values replaced with section 5.5 |
| `expert-dashboard/src/app/components/ui/*` | `web/components/ui/` | About 10 of the 48 files |

**Not carried over (AI):** `AICopilotPanel.jsx`, `AlertBadge.jsx`, `ConfidenceScore.jsx`, `AIWarningBanner.jsx`, `PreDiagnosis*.tsx`, `DiagnosisResult.tsx`, the "AI Pre-Diagnosis" card, and the eight AI relay events in `server/index.js:52-88`.

**New server rules that fix today's problems:** the server creates session numbers; a socket must be signed in to connect; a person can only join a room for a session they belong to; the server relays `laser_update` and `freeze_session`; only the web app's own address may connect.

One hosting detail: data requests go through the Next.js address (a rewrite to the Python server) so the login cookie is first-party and not blocked by Safari; the live socket connects straight to the Python server using a short-lived token.

### 7.4 Migration steps (the old app keeps working until M3 is accepted)

| Step | Work | Done when |
|---|---|---|
| **M0 Safety net** | Commit the 862 unsaved lines on a branch and tag it `pre-refactor`. Delete `.playwright-mcp/`. Save this plan to `docs/REFURBISH_PLAN.md`. Capture the section 4 screenshots. Write down the event list | Tag exists; screenshots saved |
| **M1 Python server, same behaviour** | Build `backend/` with the 11 events + the 2 missing relays, health check, tests | The **old** Vite screens complete a call against the Python server by changing only the server address |
| **M2 Next.js shell + design system** | Create `web/`, tokens, B612, basics, top nav, login screen, empty states | Every route opens with the new look; contrast check passes |
| **M3 Live call in Next.js** | Move call and drawing code into `lib/` and `components/call/`; build both call screens; remove `HAL-123` | Phone and laptop complete a call with drawing, pointer, freeze, undo, on the new app |
| **M4 Accounts and real data** | Tables, login, roles, server-made sessions, queue, history, real signal numbers | Refresh keeps history; two calls at once stay separate; no fake number left |
| **M5 P1 features** | Photos, checklists + stamp, notes/chat, report, recording with consent, link/QR join, numbers page, admin | Each P1 row demonstrated end to end |
| **M6 Speed, polish, release** | Section 8 targets, accessibility pass, relay server, hosting, delete `legacy/` | Targets met on a real mid-range phone |

Rule for the move: change one thing at a time. M1 changes the server only. M3 changes the framework only (drawing code moves unchanged). Simplifying the drawing code comes after, never during.

---

## 8. Speed plan

| Target (mid-range Android, 4G) | How |
|---|---|
| Technician home usable in under 3 s | Small first page; call code loads only when a call starts |
| Camera preview within 1.5 s of permission | Ask for the camera before loading anything else on the call page |
| Accept to first video frame under 3 s on local Wi-Fi | Open the connection while ringing; relay server ready |
| Drawings appear on the other side within 100 ms | Send positions as 0-to-1 fractions; batch pointer moves once per screen frame |
| Records pages score 90+ in Lighthouse | Pages rendered on the server; fonts bundled; no outside files |
| Smooth on cheap phones | No blur over video; hand-tracking model no longer runs every frame (parked) |

Honest note: the unused packages mostly slow down installs, not the page. The real page weight today is the 3D library and the hand-tracking model loading up front, plus files fetched from outside sites.

---

## 9. Build order and milestones (starts on approval)

You asked to build the full stack now, so this is an order of work, not a calendar. Each milestone ends with a check you can see. The pace is set mostly by the real-phone checks, which only you can do.

| Order | Milestone | Size | Ends with | Needed from you |
|---|---|---|---|---|
| 1 | M0 Safety net | Small | Branch `refurbish/nextjs-python`, tag `pre-refactor`, plan saved in `docs/` | Approving this plan also approves committing your 862 unsaved lines to that new branch (nothing is pushed) |
| 2 | M1 Python server, same behaviour | Medium | Tests pass; old screens work against it | One test call, laptop to phone |
| 3 | M2 Next.js shell + design system | Medium | Every page opens in the new look | A look at the screens: yes or change |
| 4 | M3 Live call in Next.js | **Large, the hardest part** | Full call with drawing, pointer, freeze, undo | One test call on the new app |
| 5 | M4 Accounts and real data | Medium | Login, saved history, no fake numbers | First admin name and password |
| 6 | M5 P1 features | Large | Each P1 row shown working | Try the checklist and report |
| 7 | M6 Speed, polish, release | Medium | Section 8 targets met; `legacy/` deleted | Hosting accounts and a relay-server choice |

**First build run:** M0 to M4, which delivers every P0 feature on the new stack. M5 and M6 follow. P2 is a separate block afterwards.

**Your machine is ready:** Python 3.14, `uv`, Node 24 and npm 11 are installed. Docker is not, and it is only needed for P2 item 20.

For reference, the same work done by one person without AI help would be about 34 working days (7 weeks).

---

## 10. How we check it works

| Check | How |
|---|---|
| Server | `pytest`: two test clients join a session; signals, drawings, pointer and freeze are relayed; a stranger is refused; login and session saving work |
| M1 same-behaviour check | Run the old Vite screens with `VITE_SERVER_URL` pointed at the Python server; make a real call laptop to phone |
| Whole flow, automatic | Playwright opens two browsers with a fake camera: technician calls, expert accepts, video plays, a drawing made on one side appears on the other, end call, session appears in history |
| Real devices | Android Chrome phone + laptop: same Wi-Fi, then phone on mobile data (proves the relay server) |
| Speed | Lighthouse on `/login`, `/tech`, `/sessions`; stopwatch the three call timings in section 8 |
| Accessibility | Expert console by keyboard only; contrast checker on every colour pair |
| No AI | Search the new code for `gemini`, `anthropic`, `mediapipe`, `ai_alert`: zero results in `web/` and `backend/` |

---

## 11. Risks

| Risk | Guard |
|---|---|
| The call breaks while being moved | Old app stays runnable until M3 is accepted; code is moved as-is first |
| Phone cameras need a secure (https) page | Run the dev server with https for phone testing (the technician app already does this today) |
| Small differences between the Node and Python switchboard | The M1 test compares behaviour event by event |
| One server process only (live rooms are kept in memory) | Fine for a pilot. Ceiling: about one site's worth of calls. Add Redis when more is needed |
| Photo and recording storage on free hosting is wiped on restart | Start with a local folder; move to a storage bucket only if the host has no lasting disk |
| B612 has only two weights | Fallback named in 5.5 |
| Scope growth | P2 and "Later" lists are closed for this phase |

---

## 12. Execution checklist (from the brief)

- [x] Project inspection completed (section 2)
- [x] Competitor research documented (section 3)
- [x] Visual references collected: `docs/research/screenshots/` (TeamViewer shot is blocked by a pop-up; re-capture by hand)
- [x] UI/UX redesign plan drafted (section 5)
- [x] Feature list finalised (section 6)
- [x] Refactoring roadmap created (sections 7–9)
- [x] All deliverables compiled in Markdown (this file; copied into the repo at M0)

---

## 13. Build status (updated 2026-11-15)

**Built and checked:** M0 to M5 (every P0 feature and every P1 feature, except the QR code).

| Check | Result |
|---|---|
| Server tests (`npm test`) | 5 of 5 pass: sign-in rules, privacy between calls, a whole call, a call left open is ended, a missed call |
| Two-browser call with fake cameras (`npm run e2e`) | Passes in development and production builds: call, accept, video, drawing, freeze, checklist, chat, photo, recording with consent, sign-off stamp, end, report, list, numbers |
| Contrast | Every text colour pair measured at 4.5:1 or better |
| No AI in the new code | Search for gemini, anthropic, mediapipe, ai_alert: no hits |

**Where the build differs from the plan, and why:**

| Plan said | Built instead | Why |
|---|---|---|
| M1: old Vite screens work against the Python server | Went straight to the new, signed-in protocol; the old Node app stays runnable as it was | A compatibility layer would have been thrown away in M4. The safety goal (old app still works) is met |
| Keep Three.js; move drawing code unchanged | 2D canvas, positions as fractions of the picture, one copy | The old code depended on the shared room and old message shapes, so it could not move unchanged. Smaller and faster on phones |
| Copy ~10 shadcn components | Native HTML: `<dialog>`, `<select>`, switch | No UI library needed; 5 runtime packages in total |
| Alembic migrations | Tables created on start | No real records yet. Add Alembic before the first table change on live data |
| `routers/` folder, `models.py`, `legacy/` folder | Fewer files; old app left in `ArGuide/` | Less to read; nothing gained by moving the old app |
| Join by link or QR | "Copy link" on the technician's calling screen | QR needs an extra library; add when wanted |
| Separate numbers page | Numbers on the expert's Calls page | Same data, one less page |
| (not in plan) | Each call stores a copy of its checklist steps | Editing a checklist must never change old reports |
| (not in plan) | Test mode without sign-in: server started with `DEV_NO_LOGIN=true`, each tab picks a person with `?as=<username>` | Owner asked for a way to try a call without the login getting in the way. Refused when `COOKIE_SECURE=true` |

**Bugs found and fixed while testing:** calls left open when a browser closed stayed "in progress" forever (now ended after 2 minutes with nobody connected); sign-in form could put the password in the address bar if the page script had not loaded (now always posts); two quick video offers could break the connection (offers now carry an id); a chat effect crashed on newer Chrome (scrollIntoView now returns a Promise).

**Change on 2026-11-16 (owner):** "hand-gesture drawing" and "drawings that stay stuck to the object as the camera moves" are no longer parked in "Later": they are the core of the product and were built as the AR core, on the device, with no internet. Details, results and how the build differs: [`AR_CORE_PLAN.md`](AR_CORE_PLAN.md). The "No AI" check now excludes MediaPipe, which the AR core uses on the device. Three.js is not used: the 2D canvas with per-drawing placements does what the old demo's three.js tubes did.

**Not done yet (M6 and after):** real phone test on mobile data; hosted relay server (coturn) for strict networks; hosting; real-device performance; deleting `ArGuide/` after acceptance; P2 features. Local relay-only browser connections passed over UDP, TCP and TLS; the TLS check used a self-signed certificate with browser certificate checks disabled. Two simulated mobile Lighthouse runs for expert sessions scored above 90 after deferring audio initialization.

**Improvement work (2026-11-16):** partial hand rubbing, drawing-lifetime guards, shared frame input, annotated photos and recordings, expiring TURN credentials and a reviewable single-origin deployment configuration have been added. The keyboard can draw on the expert canvas, and the recorder saves when the other participant ends the call. Browser tests use generated audio and hand landmarks; real phones, a live relay, hosted deployment and performance gates remain to be verified. See `STATUS.md` and `AR_CORE_PLAN.md` §16 for current results; these additions do not mark M6 complete.

**Owner decision (2026-11-16):** review on the computer for this phase; phone and hosted testing are not required now. The owner reports prior dashboards were deployed on Vercel. This version's hosted and real-device behavior remain unverified.

**Wrap-up (2026-11-16):** local review and automated checks passed; temporary local walkthrough servers are running for the owner. The owner requested that the work remain uncommitted and unpushed. Current links, test results, server state and remaining decisions are in `STATUS.md`.
