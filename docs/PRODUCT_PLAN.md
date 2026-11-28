# Plan: ArGuide product layer for the HAL Do-228 challenge

Approved by the owner on 2026-11-28. Progress and notes for the next session: [`STATUS.md`](../STATUS.md) §8.

## Context

The AR call app is finished and merged (STATUS.md). The next phase, "a full-stack product layer", had no definition. On 2026-11-28 the owner settled it:

| Decision (owner, 2026-11-28) | Choice |
|---|---|
| Who it's for | **HAL iDEX DRISHTI Challenge 9** (Do-228: remote expert help, pre-flight check, later defect detection and predictive maintenance). Now confirmed, no longer a guess |
| What to build | **All three, thin, in order:** aircraft register, then solo pre-flight check, then defect log |
| Who signs a solo check | **The technician signs it.** The expert's second check happens on each defect (technician marks it fixed, an expert verifies it) |
| Who adds aircraft | **Experts and admins.** Technicians pick from the list. A call for help can still use an unlisted tail number, so help is never blocked |
| When a problem becomes a defect | **When a solo check is signed.** Only checks create defects. Calls create none for now |

Why these three: HAL's scope is "pre-flight check inspection" plus "predictive maintenance". Today a checklist only exists inside a live expert call, and the aircraft is just typed text. A per-aircraft record of checks and defects closes the pre-flight gap. It also gives later predictive maintenance and AI defect detection the history they need. There's still no AI (AGENTS.md).

## My calls (owner can override)

- **Alembic for migrations** (a safe way to change tables without losing data). It's one new backend dependency, already promised in STATUS §7/§8. A hand-written helper would only cover additive changes.
- **A check is a row in the existing `sessions` table** with a new `kind` column (`call` | `check`). That reuses steps, photos, uploads, `Media`, `Stamp` and the printable report. It adds **no new status values**: a check is `active` while open, then `ended` when signed, or `cancelled`. The frontend `SessionStatus` maps stay as they are.
- **Escalation stays simple.** "Call an expert" on a check starts a normal call for the same aircraft (the same `call:start` emit as Home). The check stays open. There's no link column; the aircraft page lists both.
- **Keep the call form's Aircraft text box** (the e2e fills it), with its suggestions taken from the register. The server matches the typed tail number to the register; an unknown one still works, with a hint. The check gets its own start page with a pick list.
- **Tail numbers can't be edited after creation.** Retire an aircraft by making it inactive. When an aircraft is added, earlier calls with the same typed tail number get linked to it.
- Technicians can **read** any check (it's aircraft history). They still see only their own calls.
- One new nav item, **Fleet** (aircraft list, a page per aircraft, defects inside), for every role. Phones get at most 5 tabs.
- No made-up tail numbers or "official" Do-228 procedures are seeded. Real checklists come from the owner or HAL through the checklist editor.

## Work order: four pull requests (each branches off `main` after the previous merge)

Each PR: write the tests first, run the checks, update STATUS.md (§4 map, §5 decisions, §7 limits, session log), then **ask the owner before committing**. Push and PR only when asked.

### Step 0, on approval (docs only)
- Save this plan as `docs/PRODUCT_PLAN.md` (AGENTS: a new piece of work gets its plan in `docs/`).
- STATUS.md: record the owner's decisions (§5), replace §8 "Define the product layer" with these four steps, and add a session log row.
- Memory: update `hal-drishti-challenge.md`, since the target is now confirmed, and `refurbish-phase.md`.
- Then invoke `superpowers:writing-plans` for PR A's detailed steps.

### PR A: migrations baseline (migration 0001)
- `backend/pyproject.toml`, `uv.lock`: `uv add alembic`. Mako and MarkupSafe come along; say why in the PR.
- New `backend/app/migrations/` (`env.py` reusing `app.db.engine` or a passed connection, `render_as_batch=True`, no `fileConfig`), `versions/0001_baseline.py` with hand-written `op.create_table` calls matching today's 5 tables, and a 3-line `backend/alembic.ini` for the developer command line.
- New `backend/app/migrate.py` `upgrade_db(engine)`. If tables exist but have no version: compare their columns to the baseline. Refuse a database from before the password removal (`users.password_hash`) with the README's "use a new DATA_DIR" message, otherwise stamp it. Copy the SQLite file to `arguide.db.pre-<rev>` before upgrading a database that has data, then `upgrade head`.
- `backend/app/db.py` `init_db()`: call `upgrade_db` instead of `create_all`, then seed as now. `test_setup.py` keeps its own in-memory `create_all`.
- Rule: every migration only adds things (new tables, columns that may be empty or have a default), so rolling back the code stays safe. New columns on SQLite go through `batch_alter_table` with **named** foreign keys. A required column gets a `server_default`.
- Tests `backend/tests/test_migrations.py`: a fresh database upgrades and `compare_metadata == []` (drift guard); an unversioned database with a user is stamped and keeps the row; a `password_hash` database is refused.
- Docs: README (how to add a migration), `docs/DEPLOYMENT.md` (backup file, additive-only rule).

### PR B: aircraft register (migration 0002)
- `db.py`: an `Aircraft` table (`registration` unique, uppercased, at most 32 characters; `type` default "Do-228"; `note`; `active`; `created_at`) and `aircraft_out`. `CallSession.aircraft_id` is a nullable foreign key with an index; keep the `aircraft` text as a snapshot. `session_out` gains `aircraftId`. One `tail()` normalizer replaces the inline `.strip().upper()[:32]`.
- `api.py`: `GET /aircraft`; `POST /aircraft` (`experts_only`, 409 on a duplicate, back-links old sessions); `PATCH /aircraft/{id}` (type, note, active only); `GET /aircraft/{id}` (aircraft plus recent sessions; technicians see only their own calls). Reuse `require_role`, `_missing`, and the pydantic `...In`/`...Patch` pattern from checklists and users.
- `realtime.py` `call_start`: match the typed tail number to `aircraft_id` (active aircraft only).
- Web: `lib/types.ts` `Aircraft`; `components/top-nav.tsx` adds Fleet to `useSections()`; new `app/(app)/(nav)/fleet/page.tsx` (list plus an add form for experts and admins, copying the `checklists/page.tsx` pattern) and `fleet/[id]/page.tsx` (detail, edit note/active, `SessionList`); `tech/page.tsx` datalist from `/aircraft` with a "not in the register" hint; `expert/page.tsx` adds an empty-register nudge (copy `needsTechnician`).
- Tests: move `base_url`/`acting_as`/`Person` from `test_call_flow.py` into `tests/conftest.py` (session scope; one server shared by all files). New `test_aircraft.py` with unique tail numbers and before/after count comparisons, so the order-dependent counts in `test_call_flow.py` still hold: roles, normalising, duplicate 409, tail number can't be edited, `call:start` matching and the unknown-tail case, back-linking, data surviving 0001→head plus the backup file. e2e: the expert adds VT-ABC through the API first, then `/fleet/{id}` shows the call.

### PR C: solo pre-flight check (migration 0003)
- `db.py`: `CallSession.kind` with `server_default="call"`. `session_out` gains `kind`.
- New `backend/app/steps.py`: `set_step(...)` and `sign_off(...)`, moved out of `realtime.step_set` and `realtime.signoff` so the socket and REST paths share one function. Catch `IntegrityError` when two requests save the same step at once. The existing whole-call test guards the move.
- `realtime.py` guards: `watch_open_calls` only for `kind == "call"`, otherwise a restart would end open checks after 120 s; `session_join` rejects checks.
- `api.py`:
  - `POST /checks` (technician or admin; active aircraft and checklist required; copy the checklist snapshot like `call_start`; return the existing check if one is already open for that aircraft and technician).
  - `PUT /sessions/{id}/steps/{step}` (checks only, own technician, 409 once signed).
  - `POST /sessions/{id}/signoff` (own technician, every step needs a result, sets `ended`).
  - `POST /sessions/{id}/cancel` (only with no results).
  - `kind` filter on `/sessions`; `stats` counts calls only; `_visible_session` lets everyone read checks; uploads give 409 on a signed check; `GET /aircraft` adds last check and check-in-progress.
- Web:
  - `components/work.tsx`: narrow `StepCard` props to `{steps, results, signedOff, onSet, onHide?, doneText?}` and update its one caller in `tech/session/[id]/page.tsx`. Wrap it in a `.live` card on the light page.
  - New `app/(app)/tech/check/page.tsx` (aircraft and checklist pick lists, "Start pre-flight check").
  - New `tech/check/[id]/page.tsx`: step card; answered steps with "Change"; "Take photo" (`<input type="file" accept="image/jpeg,image/png" capture="environment">` to the existing upload endpoint); `Media`; "Sign pre-flight check", which says why it's disabled; `Stamp`; "Call an expert"; "Cancel check". Buttons at least 56 px, each with a label.
  - `tech/page.tsx`: a "Pre-flight check" card plus a "Continue" banner; recent calls use `kind=call`.
  - `sessions/[id]/page.tsx`, `components/sessions.tsx`, `sessions/page.tsx`: wording for checks (no "Expert", "Answered" or "Call ended"; "Return to check" link).
  - `fleet/[id]`: "Start pre-flight check".
- Tests `test_checks.py`:
  - Starting: roles, inactive aircraft or checklist rejected, a second start returns the same check.
  - Steps: done, problem, clear; bad index; 409 once signed; another technician's check; a call refused.
  - Signing: incomplete 409; ends the check; an expert gets 403; signing twice is harmless; cancel only with no results.
  - Guards: `session_join` on a check; a check stays open through `watch_open_calls` with `ABANDON_AFTER=0.3`; `stats.calls` doesn't change.
  - Uploads: work while open, 409 after signing.
  - Migration: old rows become `kind == "call"`.
  - e2e: add a check scenario (VT-ABC, steps, sign, `SIGNED OFF` on the report).

### PR D: defect log (migration 0004)
- `db.py`: `Defect` table (`aircraft_id` required, `session_id`, `step`, `text` = step text plus note, `status` open|fixed|verified, `raised_by/at`, `fixed_by/at`, `fix_note`, `verified_by/at`; unique `(session_id, step)`) and `defect_out`.
- `steps.sign_off`: for checks only, create a defect per problem step in the same database transaction. The unique pair makes a second sign-off harmless.
- `api.py`: `GET /defects?status=&aircraft_id=`; `PATCH /defects/{id}` with `{action: fix|verify|reopen, note}`, done as a guarded UPDATE that checks the current status so a double click returns 409. Rules: fix only from open, note required; verify or reopen only from fixed; reopen needs a note; technicians can't verify; the person who fixed can't verify. Aircraft list and detail gain defect counts and lists (open first); session detail gains its defects.
- Web: new `lib/defects.ts` `defectActions(defect, me)` (which buttons show) with `lib/defects.test.ts`; Fleet list shows open-defect counts (warn colour = status, allowed) and "Waiting to verify" for experts; `fleet/[id]` defect cards with Mark fixed, Verify, Reopen; `expert/page.tsx` "n fixes to verify" banner; a "Defects raised" section on the report.
- Tests `test_defects.py`:
  - Raising: 2 problem steps give 2 defects; done steps give none; a second sign-off gives no duplicates; **a signed-off call with a problem step gives none**.
  - Rules: fix needs a note; a technician's verify gets 403; the fixer's own verify is refused; double verify 409; reopen needs a note; counts are right.
  - Node test: every role and status combination in `defectActions`.
  - e2e: problem, sign, the defect shows on Fleet, the technician fixes it, the expert verifies, the banner clears.

## Separate, needs the owner (any time, about 10 minutes)
- **Real-webcam try** of the thumbs-down clear and the shrinking checklist (STATUS §8). It doesn't block the steps above.

## New known limits to record (STATUS §7)
No defect history log yet (upgrade: a `defect_events` table). "The verifier must differ from the fixer" means little without sign-in. A check can't be handed over to another technician mid-way. One API process only (migrations run at start-up). Defects are a manual log, not AI detection.

## Verification (every PR, per AGENTS.md)
```bash
npm test                                   # server tests incl. new test_*.py
npm --prefix web test                      # node tests (defects.test.ts in PR D)
(cd web && npx tsc --noEmit && npx next build)
npm run e2e                                # production build and next dev; Brave if behaviour differs
```
Plus, by hand at a phone width (390×844): start a check, reload it mid-way (progress kept), restart the API mid-check (still open after 2 minutes), take a photo, sign, print the report. After PR D: the whole flow on Fleet. Report exactly what passed, what failed, and what couldn't run.
