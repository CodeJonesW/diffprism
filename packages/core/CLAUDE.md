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
- `src/dojo.ts` — Review dojo types and `combineFindings()`, which turns the agents' votes into agreed/disputed/partial/solo. Plain arithmetic, never a model
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
- **Idle expiry:** a session nobody is viewing, waiting on (a blocked caller polling `/result` counts), or changing for `idleSessionTtl` (24h) is removed, and its watcher stops. Before this, a UI-opened session was only removed by an explicit close and an `in_review` session matched no expiry rule, so both could poll forever.

## Dependencies

Runtime: `@diffprism/git`, `@diffprism/analysis`, `ws`, `open`.
