# Instructions for AI agents working on ArGuide

These rules apply to every agent and every session (Claude Code reads them through `CLAUDE.md`).

## At the start of every session

1. Read [`STATUS.md`](STATUS.md) in full. It is the single source of truth for where the work stands. Finished plans are in [`docs/history/`](docs/history/) (`REFURBISH_PLAN.md` holds the design and the reasoning behind it); read them only when you need that background.
2. Check for work that `STATUS.md` does not mention yet:
   ```bash
   git status --short
   git log --oneline <"Last commit" from STATUS.md>..HEAD
   ```
3. If anything was done that `STATUS.md` doesn't describe (new commits, changed files, a decision the owner made), **update `STATUS.md` first**: the affected sections, the "Last updated" line, and a new row in the session log. Then start the new work.

## While working

- Keep `STATUS.md` true. When you finish a feature, fix a bug, or the owner makes a decision, update the matching section and the session log row for today.
- Build new work in `web/` (Next.js 16) and `backend/` (Python). The old prototype (`ArGuide/`) was removed on 2026-11-21, after the owner accepted the app; it stays in git history under the tag `pre-refactor`.
- **No AI features until the owner starts the AI phase** (no Gemini, Anthropic, OpenAI, defect detection, nothing in the cloud). The owner accepted the refurbished app on 2026-11-21, but the next phase is full-stack product work, not AI. **One exception (owner, 2026-11-16):** the AR core may use on-device hand tracking (MediaPipe) and OpenCV.js, served from our own `web/public/vendor/`, never from the internet. Design: [`docs/history/AR_CORE_PLAN.md`](docs/history/AR_CORE_PLAN.md).
- Work on a branch off `main` and bring it in through a pull request merged with a merge commit, so the separate commits stay in the history.
- Nothing may call outside services while the app runs (closed-network ready). The default STUN server in `ICE_SERVERS` is the only exception.
- Follow the "Flight line" design: tokens in `web/app/globals.css`, rules in `STATUS.md` §5. Live-call screens dark, everything else light. Status colours only for status. Text contrast ≥ 4.5:1. Technician buttons ≥ 56 px with a label.
- Keep dependencies few. Prefer native HTML and the standard library. Add a package only for a real need, and say why.
- Before changing Next.js-specific code, read the bundled docs (`web/node_modules/next/dist/docs/`; see `web/AGENTS.md`).
- `DEV_NO_LOGIN=true` is for local testing only. Never set it on a hosted site.
- Commit only when the owner asks. Never push without being asked. Never put secrets, passwords or personal details in docs or commits.
- The owner is new to development. Explain in plain words, with short tables, and end replies that report work with a "What's next" section.

## Checks before saying something works

```bash
npm test                                   # server tests (repo root)
cd web && npm test                         # AR unit tests (tracker accuracy, hand gestures, drawing projection)
cd web && npx tsc --noEmit && npx next build
npm run e2e                                # needs both servers running and the e2e accounts (STATUS.md §3); the Python server in NORMAL login mode, not DEV_NO_LOGIN
E2E_CLIP=object E2E_FAKE_HAND=1 npm run e2e  # still camera, moving card; generated hand: rub, pinch line (see README "Checks")
```
Run the e2e against the production build and against `next dev`, and in Brave when behaviour differs between browsers (`CHROME_PATH`).

Report results honestly: say what passed, what failed, and what you could not run.

## When the owner says "wrap up"

Leave the project so that the next session (or a different agent) can pick it up with nothing lost:

1. **Run the checks** above (and the end-to-end test if the servers can run). Note the results.
2. **Update `STATUS.md`** throughout:
   - "Last updated" date, branch, last commit
   - milestone table, features that work, checks and their results, "not yet tested"
   - decisions the owner made this session (§5), lessons learned (§6), known limits (§7)
   - next steps (§8), with anything waiting on the owner marked clearly
   - a new session log row: what was done, what was decided, what is unfinished
   - the state of running servers or temporary data, and that temporary data is not kept
3. **Plans:** a new piece of work gets its plan in `docs/`. When the work is done, move the plan to `docs/history/` and leave it as it was (don't rewrite history); the current state lives in `STATUS.md`.
4. **Update `README.md` and the `.env.example` files** if how to run, test or configure the app changed.
5. **Update this file** if the owner gave a new standing rule.
6. Check the docs contain no secrets, real passwords or personal details. The demo password `demo-pass-1` is fine; it's only for throwaway test accounts.
7. **Stop servers you started**, or note in `STATUS.md` that they are still running.
8. **Ask the owner whether to commit.** If yes, commit everything on the current branch with a clear message. Don't push unless asked.
9. Reply with a short summary of the session and a "What's next" section.
