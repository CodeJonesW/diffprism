# @diffprism/core

Shared types + server-client utilities + global server. This is the central package that wires everything together.

## Key Files

- `src/types.ts` — **The contract.** All shared interfaces live here. Every other package imports from this.
- `src/server-client.ts` — `ensureServer()` auto-starts daemon + `submitReviewToServer()` computes diff locally, POSTs to server, polls for result.
- `src/global-server.ts` — `startGlobalServer()`: HTTP API + WS for multi-session reviews. Manages sessions, relays results.
- `src/server-file.ts` — Read/write `~/.diffprism/server.json` discovery file, PID liveness + HTTP ping checks.
- `src/review-manager.ts` — In-memory session tracking (Map of id → state).
- `src/ui-server.ts` — Vite dev server management for the review UI.
- `src/diff-poller.ts` — Watches repos for diff changes on an interval.

## Important Patterns

- `ensureServer()` checks `isServerAlive()`, and if no server is running, spawns a detached daemon process (`diffprism server --_daemon`) and polls until ready. Logs go to `~/.diffprism/server.log`.
- `submitReviewToServer()` dynamically imports `@diffprism/git` and `@diffprism/analysis` to keep `ensureServer()` lightweight for MCP cold starts.
- `silent: true` suppresses all stdout. Critical for MCP mode.
- Empty diff returns early with an "approved" result instead of opening browser.
- Global server sends `session:list` to WS clients connecting without a sessionId, handles `session:select` for switching.

## Dependencies

Runtime: `@diffprism/git`, `@diffprism/analysis`, `ws`, `open`.
