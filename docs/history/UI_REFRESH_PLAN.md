# Plan: livelier ArGuide and a clean start (2026-11-28)

## Why
The owner wants to wrap up the project: no testing data, nothing on screen that reads as unfinished or
machine-written, livelier screens with more ways to get around. AI features and hardware come later, not now.

## Owner's choices
| Question | Choice |
|---|---|
| Data | Clean start: delete the test call and made-up people; first screen creates your own admin; keep the three checklists as editable starter templates |
| Look | Livelier, same "Flight line" identity (rejected: a new style; tidy only) |
| Navigation | Home hub + phone tab bar (rejected: side menu; keep the top bar) |

## Design (builder's calls)
- Same tokens and B612 type. B612 Mono only for session codes and aircraft registrations; numbers and times use
  B612 with tabular figures (the mono figures read as "2. 7 min").
- One focal element: a dark **live board** on Home for what is live (waiting calls, "Call an expert"), tying Home
  to the dark call screens. Everything else stays light and quiet.
- Existing app mark reused in the top bar, sign-in screen and live board. Initials circles for people.
- Status pills with an icon and a word, status colours only for status, text at least 4.5:1.
- One motion only: the ring around the live board's mark while a call is waiting (reduced motion respected).
- No developer notes or sample values on screen. Empty screens say what to do next.

## Tasks
1. Server: `POST /api/auth/setup {name}` creates the first admin only while there are no people (test first).
2. Shared pieces: mark, avatar, status pill, page heading, empty state with an icon.
3. Navigation: icons in the top bar; bottom tab bar on phones (hidden in the expert's call screen and in print).
4. Screens: sign-in and first-run set-up, expert Home hub, technician Home, Sessions (cards on phones), report,
   Checklists, People; pop-up messages moved so they cover no buttons.
5. Delete the local database. Update README, AGENTS, `.env.example`, deployment notes and STATUS for no sign-in.
6. Checks, then a pull request into `main`, merged with a merge commit.

Not changed: the AR core and the two live-call screens, apart from where pop-up messages appear.

## Verification
Server and web tests, type check, both builds, two-browser call test (plain, synthetic hand, moving card; production
and `next dev`), and screenshots of every screen on computer and phone sizes, including an empty database.
