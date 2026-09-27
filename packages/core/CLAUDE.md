# @diffprism/core

Shared types + server-client utilities + global server. This is the central package that wires everything together.

## Key Files

- `src/types.ts` — **The contract.** All shared interfaces live here. Every other package imports from this.
- `src/server-client.ts` — `ensureServer()` auto-starts daemon + `submitReviewToServer()` computes diff locally, POSTs to server, polls for result.
- `src/global-server.ts` — `startGlobalServer()`: HTTP API + WS for multi-session reviews. Manages sessions, relays results.
- `src/server-file.ts` — Read/write `~/.diffprism/server.json` discovery file, PID liveness + HTTP ping checks.
- `src/review-manager.ts` — In-memory session tracking (Map of id → state).
- `src/ui-server.ts` — Vite dev server management for the review UI.
- `src/diff-poller.ts` — Watches a repo for diff changes. The delay before each poll is asked for anew, so it can change; `wake()` polls immediately.
- `src/diff-scope.ts` — Which diff a review shows: the default ref, the commit gate's, and `diffNewSide()`, where the new side of a diff lives (#238).
- `src/dojo.ts` — Review dojo types, `DojoSubject` (a PR, or a local change), `DojoStoppedError`, and `combineFindings()`, which turns the agents' votes into agreed/disputed/partial/solo. Plain arithmetic, never a model
- `src/since-last-look.ts` — `sinceLastLook()`: which files and hunks of a diff are new since the one the reviewer last saw (#265). Hunks are matched by the lines they add and remove (not line numbers or context), counted so identical hunks are each accounted for, and `lines` cites only added lines. The server keeps a session's `seenDiff` (last delivered to a viewer) and `sinceBase` (what the reviewer saw before unseen changes), and sends `review:since` after each delivery. `POST /api/reviews/:id/seen` clears it; comparing another ref, or reopening the review on one, starts over. A viewer is marked as having seen the diff only after `attachViewer` polls, so a first look never starts from a stale snapshot.
- `src/watch-schedule.ts` — `watcherPollDelay()`: how often a session's watcher runs `git diff`.

## Important Patterns

- `ensureServer()` checks `isServerAlive()`, and if no server is running, spawns a detached daemon process (`diffprism server --_daemon`) and polls until ready. Logs go to `~/.diffprism/server.log`.
- `submitReviewToServer()` dynamically imports `@diffprism/git` and `@diffprism/analysis` to keep `ensureServer()` lightweight for MCP cold starts.
- `silent: true` suppresses all stdout. Critical for MCP mode.
- Empty diff returns early with an "approved" result instead of opening browser.
- Global server sends `session:list` to WS clients connecting without a sessionId, handles `session:select` for switching. All three ways a client starts viewing a session go through `attachViewer()`.

## Watcher cost

Every session with a diff ref runs `git diff` on a timer, so watchers are budgeted:

- **Viewed:** every `pollInterval` (2s).
- **Unviewed:** `unviewedPollInterval` (30s), doubling for each quiet poll up to `unviewedPollMaxInterval` (5 min), back to 30s on a change. The new-changes signal still fires, with bounded latency.
- **Instant paths don't poll.** A hook or agent opening a review updates the session directly, and `attachViewer()` wakes a backed-off watcher so the viewer never sees a stale diff.
- **Who's waiting (#204):** a caller blocked on the decision says what it is as it polls (`GET /result?caller=commit|review|agent&until=…`, from `waitForDecision`'s `caller` option). The session's summary carries `caller: { kind, waiting, until }`. A watchdog marks it not waiting after `callerGoneMs` (6s) without a poll. Viewing a review only moves it from pending to in review; a decided review stays decided (#269).
- **Landed:** a decided local review whose diff goes empty is removed at once, by the watcher: the change it judged has landed (the commit the gate let through) or been dropped. Left alone, it showed "0 files changed" with the decision buttons until its 5-minute expiry.
- **Idle expiry:** a session nobody is viewing, waiting on (a blocked caller polling `/result` counts), or changing for `idleSessionTtl` (24h) is removed, and its watcher stops. Before this, a UI-opened session was only removed by an explicit close and an `in_review` session matched no expiry rule, so both could poll forever.

## Dependencies

Runtime: `@diffprism/git`, `@diffprism/analysis`, `ws`, `open`.
