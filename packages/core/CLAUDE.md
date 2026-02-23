# @diffprism/core

Shared types + pipeline orchestrator + global server. This is the central package that wires everything together.

## Key Files

- `src/types.ts` — **The contract.** All shared interfaces live here. Every other package imports from this.
- `src/pipeline.ts` — `startReview()` orchestrator: getDiff → analyze → start servers → open browser → wait → cleanup
- `src/ws-bridge.ts` — WebSocket server wrapping the `ws` library. Single-client per review session.
- `src/review-manager.ts` — In-memory session tracking (Map of id → state).
- `src/global-server.ts` — `startGlobalServer()`: HTTP API + WS for multi-session reviews. Manages sessions, relays results.
- `src/server-file.ts` — Read/write `~/.diffprism/server.json` discovery file, PID liveness + HTTP ping checks.

## Important Patterns

- Pipeline resolves UI path relative to `import.meta.url`, walking up to workspace root. If you move files, update `resolveUiRoot()`.
- `silent: true` suppresses all stdout and sets Vite `logLevel: "silent"`. Critical for MCP mode.
- WS bridge stores pending init payload if client hasn't connected yet — sends on connection.
- Empty diff returns early with an "approved" result instead of opening browser.
- Global server sends `session:list` to WS clients connecting without a sessionId, handles `session:select` for switching.

## Dependencies

Runtime: `@diffprism/git`, `@diffprism/analysis`, `ws`, `open`, `get-port`, `vite` (for programmatic dev server).
