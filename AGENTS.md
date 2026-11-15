# Instructions for AI agents working on ArGuide

These rules apply to every agent and every session (Claude Code reads them through `CLAUDE.md`).

## At the start of every session

1. Read [`STATUS.md`](STATUS.md) in full. It is the single source of truth for where the work stands. Read [`docs/REFURBISH_PLAN.md`](docs/REFURBISH_PLAN.md) when you need the design or the reasoning behind it.
2. Check for work that `STATUS.md` does not mention yet:
   ```bash
   git status --short
   git log --oneline <"Last commit" from STATUS.md>..HEAD
   ```
3. If anything was done that `STATUS.md` doesn't describe (new commits, changed files, a decision the owner made), **update `STATUS.md` first**: the affected sections, the "Last updated" line, and a new row in the session log. Then start the new work.

## While working

- Keep `STATUS.md` true. When you finish a feature, fix a bug, or the owner makes a decision, update the matching section and the session log row for today.
- Build new work in `web/` (Next.js 16) and `backend/` (Python). `ArGuide/` is the old prototype: don't change it, and don't delete it until the owner accepts the new app.
- **No AI features in this phase** (no Gemini, Anthropic, OpenAI, MediaPipe, defect detection). The owner decided this. The AI phase starts only after they accept the refurbished stack.
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
cd web && npx tsc --noEmit && npx next build
npm run e2e                                # needs both servers running and the e2e accounts (STATUS.md §3)
```

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
3. **Update `docs/REFURBISH_PLAN.md` §13** if the work differed from the plan, and tick anything in §12 that is now done.
4. **Update `README.md` and the `.env.example` files** if how to run, test or configure the app changed.
5. **Update this file** if the owner gave a new standing rule.
6. Check the docs contain no secrets, real passwords or personal details. The demo password `demo-pass-1` is fine; it's only for throwaway test accounts.
7. **Stop servers you started**, or note in `STATUS.md` that they are still running.
8. **Ask the owner whether to commit.** If yes, commit everything on the current branch with a clear message. Don't push unless asked.
9. Reply with a short summary of the session and a "What's next" section.
