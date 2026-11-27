# ArGuide

Live remote help for aircraft maintenance. A technician points a phone camera at the job; a remote expert sees it, draws on it, walks through a checklist and signs it off. Every call is saved as a printable report.

Drawings can follow the part as the camera moves. The technician can pinch to draw, rub with an open palm to erase part of a drawing, or hold a thumbs-down for one second to clear the screen. The tracking runs on the device using files served by the app. Real-hand and phone checks are still open. See [the AR core plan](docs/history/AR_CORE_PLAN.md).

**Use ArGuide on your computer or a private network you trust.** People choose a name when they open the app. Anyone who can reach it can act as any person, including an admin, so keep it off the public internet.

| Folder | What it is |
|---|---|
| `web/` | The screens (Next.js). Technician phone view, expert console, sessions, reports, admin |
| `backend/` | The server (Python, FastAPI). People, records and the live link between the two sides |
| `docs/` | `DEPLOYMENT.md` (single-address pilot and self-hosted relay setup) and `history/` (the finished plans: refurbish, AR core, review round) |
| `deploy/` | Example Caddy, systemd and coturn files for the pilot deployment |
| `STATUS.md` | Where the work stands today. Read this first |
| `AGENTS.md` | Rules for AI coding agents, including what "wrap up" means |

The first version of the app (old Node server and two Vite apps) was removed on 2026-11-21. It stays in git history under the tag `pre-refactor`.

## Run it on your computer

You need Python 3.12 or newer with [uv](https://docs.astral.sh/uv/) and Node.js 24. The web tests run TypeScript directly.

```bash
npm run setup                                    # install both parts once (also copies the AR files into web/public/vendor)
```

Then, in two terminals:

```bash
npm run dev:api     # server on http://127.0.0.1:8000
npm run dev:web     # screens on http://localhost:3000
```

Open http://localhost:3000. On a fresh database, enter your name to create the first admin. Add technicians and experts on the **People** page and edit the three starter checklists on **Checklists**. If port 3000 is busy, start the screens with `cd web && npx next dev -p 3100` and open that address instead.

If you are moving from the old password-based database, keep that database and start the API with a new `DATA_DIR` so ArGuide can create its current tables.

## Try a call in two tabs

Open two tabs in the same browser and choose a person in each, expert first. You can also open the pages directly with the usernames you set on **People**.

- http://localhost:3000/expert?as=EXPERT_USERNAME
- http://localhost:3000/tech?as=TECHNICIAN_USERNAME

Each tab remembers the person you chose. Use **Switch person** to choose someone else.

To see the numbers behind hand and drawing behaviour (tracker and hand speed, gesture, pinch size, every drawing's state), add `?debug=ar` to a call page's address.

## Try a call with a phone

A phone needs HTTPS to use its camera. On the same trusted Wi-Fi network as your computer, stop the regular web server and start the HTTPS version.

```bash
cd web && npm run dev:phone     # https on your computer's network address, port 3000
```

Open `https://<your-computer's-address>:3000` on the phone, accept the local certificate warning, and choose a technician. Choose an expert on the computer.

## Checks

```bash
npm test            # first-admin setup, roles, call flow, storage and relay credentials
npm --prefix web test
cd web && npm run typecheck && npm run build
```

The two-browser check runs a complete call with generated camera and audio input. Create its two people in a temporary directory and start the API from `backend/`. Run these commands in the same terminal so they share `ARGUIDE_TEST_DATA`.

```bash
cd backend
export ARGUIDE_TEST_DATA="$(mktemp -d)"
DATA_DIR="$ARGUIDE_TEST_DATA" uv run python -m app.cli create-user ravi "Ravi Kumar" technician
DATA_DIR="$ARGUIDE_TEST_DATA" uv run python -m app.cli create-user mehta "Dr. Mehta" expert
DATA_DIR="$ARGUIDE_TEST_DATA" ICE_SERVERS='[]' uv run uvicorn app.main:app --port 8001
```

From `web/` in another terminal, start `BACKEND_URL=http://127.0.0.1:8001 npm run dev -- -p 3200`. To check the production build, run `BACKEND_URL=http://127.0.0.1:8001 npm run build` and then `npm run start -- -H 127.0.0.1 -p 3200`. With both servers running, use `BASE_URL=http://127.0.0.1:3200 npm run e2e` from the repo root. Install Chromium with `npx playwright install chromium` from `web/` or set `CHROME_PATH` to a local browser. Stop the test servers and remove the temporary data when finished.

- `E2E_FAKE_HAND=1`: also feeds generated hand landmarks through the gesture flow (open palm rubs, a pinch draws one line, a held thumbs-down clears all). It does not test recognition of a real hand.
- `E2E_CLIP=object`: the test camera stays still while a small card carrying the dot moves, to check that drawings follow an object and not the background.
- `BASE_URL` (default `http://127.0.0.1:3000`) and `CHROME_PATH` choose the site and the browser, for example `next dev` or Brave.

## Settings

Server settings are in `backend/.env.example`; web settings in `web/.env.example`. For a closed network, nothing in the app calls outside services while running, except the default video helper server in `ICE_SERVERS`, which you can replace with your own. The web app also tells the browser to refuse any other outside connection (`Content-Security-Policy` in `web/next.config.ts`); the hand-tracking library would otherwise send usage logs to Google.

For a self-hosted coturn relay, `TURN_URLS` and `TURN_SHARED_SECRET` enable short-lived credentials issued by the Python server. See [deployment instructions](docs/DEPLOYMENT.md). This version's hosted setup and relay have not been verified.
