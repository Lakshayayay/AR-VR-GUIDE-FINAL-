# ArGuide

Live remote help for aircraft maintenance. A technician points a phone camera at the job; a remote expert sees it, draws on it, walks through a checklist and signs it off. Every call is saved as a printable report.

| Folder | What it is |
|---|---|
| `web/` | The screens (Next.js). Technician phone view, expert console, sessions, reports, admin |
| `backend/` | The server (Python, FastAPI). Sign-in, saving, and the live link between the two sides |
| `docs/` | The refurbish plan, competitor research and reference screenshots |
| `ArGuide/` | The old app, kept until the new one is accepted. Not used by the new app |
| `STATUS.md` | Where the work stands today. Read this first |
| `AGENTS.md` | Rules for AI coding agents, including what "wrap up" means |

## Run it on your computer

You need Python 3.12 or newer with [uv](https://docs.astral.sh/uv/), and Node.js 20 or newer.

```bash
npm run setup                                    # install both parts once
cd backend && uv run python -m app.cli create-user admin "Your Name" admin   # first account (asks for a password)
```

Then, in two terminals:

```bash
npm run dev:api     # server on http://127.0.0.1:8000
npm run dev:web     # screens on http://localhost:3000
```

Open http://localhost:3000 and sign in. Add technicians and experts on the **People** page.

## Try a call without signing in (local testing only)

Start the server in test mode instead of `npm run dev:api`:

```bash
cd backend && DEV_NO_LOGIN=true uv run uvicorn app.main:app --port 8000
```

Then open two tabs in the same browser, expert first:

- http://localhost:3000/expert?as=EXPERT_USERNAME
- http://localhost:3000/tech?as=TECHNICIAN_USERNAME

Each tab acts as the person named after `?as=`. Never use test mode on a hosted site; the server refuses it when `COOKIE_SECURE=true`.

## Try a call with a phone

A phone only lets a web page use its camera over https. On the same Wi-Fi as your computer:

```bash
cd web && npm run dev:phone     # https on your computer's network address, port 3000
```

Open `https://<your-computer's-address>:3000` on the phone, accept the certificate warning, and sign in as a technician. Sign in as an expert on the computer.

## Checks

```bash
npm test            # server tests: sign-in, privacy between calls, a whole call, abandoned and missed calls
npm run e2e         # two browsers with fake cameras run a whole call (both servers must be running;
                    # needs accounts "ravi" (technician) and "mehta" (expert, named Dr. Mehta) with password demo-pass-1)
```

## Settings

Server settings are in `backend/.env.example`; web settings in `web/.env.example`. For a closed network, nothing in the app calls outside services while running, except the default video helper server in `ICE_SERVERS`, which you can replace with your own.
