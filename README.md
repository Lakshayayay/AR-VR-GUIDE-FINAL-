# ArGuide

Live remote help for aircraft maintenance. A technician points a phone camera at the job; a remote expert sees it, draws on it, walks through a checklist and signs it off. Every call is saved as a printable report.

**Augmented reality:** drawings can follow the part under them as the camera moves. The technician can pinch to draw, or hold an open palm still briefly and then rub to erase portions of a drawing. Undo and Clear all are buttons; Guide shows or hides the hand outline. These features run on the device from locally served files. They have automated coverage, but real-hand and phone acceptance is still outstanding: see [`docs/history/AR_CORE_PLAN.md`](docs/history/AR_CORE_PLAN.md).

| Folder | What it is |
|---|---|
| `web/` | The screens (Next.js). Technician phone view, expert console, sessions, reports, admin |
| `backend/` | The server (Python, FastAPI). Sign-in, saving, and the live link between the two sides |
| `docs/` | `DEPLOYMENT.md` (single-address pilot and self-hosted relay setup) and `history/` (the finished plans: refurbish, AR core, review round) |
| `deploy/` | Example Caddy, systemd and coturn files for the pilot deployment |
| `STATUS.md` | Where the work stands today. Read this first |
| `AGENTS.md` | Rules for AI coding agents, including what "wrap up" means |

The first version of the app (old Node server and two Vite apps) was removed on 2026-11-21. It stays in git history under the tag `pre-refactor`.

## Run it on your computer

You need Python 3.12 or newer with [uv](https://docs.astral.sh/uv/), and Node.js 20 or newer.

```bash
npm run setup                                    # install both parts once (also copies the AR files into web/public/vendor)
cd backend && uv run python -m app.cli create-user admin "Your Name" admin   # first account (asks for a password)
```

Then, in two terminals:

```bash
npm run dev:api     # server on http://127.0.0.1:8000
npm run dev:web     # screens on http://localhost:3000
```

Open http://localhost:3000 and sign in. Add technicians and experts on the **People** page. If port 3000 is already used by another program, start the screens with `cd web && npx next dev -p 3100` and open that address instead.

## Try a call without signing in (local testing only)

Start the server in test mode instead of `npm run dev:api`:

```bash
cd backend && DEV_NO_LOGIN=true uv run uvicorn app.main:app --port 8000
```

Then open two tabs in the same browser, expert first:

- http://localhost:3000/expert?as=EXPERT_USERNAME
- http://localhost:3000/tech?as=TECHNICIAN_USERNAME

Each tab acts as the person named after `?as=`. Never use test mode on a hosted site; the server refuses it when `COOKIE_SECURE=true`.

To see the numbers behind hand and drawing behaviour (tracker and hand speed, gesture, pinch size, every drawing's state), add `?debug=ar` to a call page's address.

## Try a call with a phone

A phone only lets a web page use its camera over https. On the same Wi-Fi as your computer:

```bash
cd web && npm run dev:phone     # https on your computer's network address, port 3000
```

Open `https://<your-computer's-address>:3000` on the phone, accept the certificate warning, and sign in as a technician. Sign in as an expert on the computer.

## Checks

```bash
npm test            # server tests: sign-in, privacy between calls, a whole call, abandoned and missed calls
cd web && npm test  # AR tests: drawings follow a moving, zooming, turning, tilting camera; pinch and gestures
npm run e2e         # two browsers run a whole call with a moving test panel and generated audio from both sides;
                    # checks drawings, saved audio/video and that no requests leave our server
                    # (both servers must be running; needs accounts "ravi" (technician) and "mehta"
                    # (expert, named Dr. Mehta) with password demo-pass-1)
```

The e2e signs in with passwords, so the Python server must run in **normal** mode. With `DEV_NO_LOGIN=true` everyone acts as the first expert and the test's "technician" becomes the expert.

- `E2E_FAKE_HAND=1`: also feeds generated hand landmarks through the gesture flow (open palm rubs, a pinch draws one line). It does not test recognition of a real hand.
- `E2E_CLIP=object`: the test camera stays still while a small card carrying the dot moves, to check that drawings follow an object and not the background.
- `BASE_URL` (default `http://127.0.0.1:3000`) and `CHROME_PATH` choose the site and the browser, for example `next dev` or Brave.

## Settings

Server settings are in `backend/.env.example`; web settings in `web/.env.example`. For a closed network, nothing in the app calls outside services while running, except the default video helper server in `ICE_SERVERS`, which you can replace with your own. The web app also tells the browser to refuse any other outside connection (`Content-Security-Policy` in `web/next.config.ts`); the hand-tracking library would otherwise send usage logs to Google.

For a self-hosted coturn relay, `TURN_URLS` and `TURN_SHARED_SECRET` enable short-lived credentials issued by the Python server. See [deployment instructions](docs/DEPLOYMENT.md). This version's hosted setup and relay have not been verified.
