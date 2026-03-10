# @diffprism/mcp-server

MCP (Model Context Protocol) server exposing DiffPrism tools to Claude Code and other MCP clients.

## Key Files

- `src/index.ts` — `startMcpServer()` creates an McpServer, registers 8 tools, connects StdioServerTransport.

## Tools

### `open_review`
- **Params:** `diff_ref` (required), `title`, `description`, `reasoning`, `timeout_ms`, `annotations` (all optional)
- **Behavior:** Calls `ensureServer()` to auto-start the daemon if needed, then `submitReviewToServer()` to compute diff locally and POST to server. Returns immediately by default (non-blocking). If `timeout_ms` > 0, polls for a result up to that duration.
- **Returns:** Session creation confirmation with `sessionId` (non-blocking), or `ReviewResult` as JSON if `timeout_ms` caused a blocking wait.

### `update_review_context`
- **Params:** `reasoning`, `title`, `description` (all optional)
- **Behavior:** POSTs context update to the server for the most recent session. Requires a prior `open_review` call.

### `get_review_result`
- **Params:** `wait` (optional bool), `timeout` (optional number)
- **Behavior:** Polls the server for the most recent session's result. Use `wait: true` to block until a reviewer submits — this is the standard way to await a decision after `open_review`.

### `get_diff`
- **Params:** `diff_ref` (required)
- **Behavior:** Runs `getDiff()` locally and returns the structured `DiffSet` as JSON. No server needed.

### `analyze_diff`
- **Params:** `diff_ref` (required)
- **Behavior:** Runs `getDiff()` + `analyze()` locally and returns the `ReviewBriefing` as JSON. No server needed.

### `add_annotation`
- **Params:** `session_id` (required), `file`, `line`, `body`, `type` (required), `confidence`, `category`, `source_agent` (optional)
- **Behavior:** POSTs a structured finding to a review session on the server.

### `get_review_state`
- **Params:** `session_id` (optional, defaults to most recent)
- **Behavior:** Fetches session metadata and annotations from the server.

### `flag_for_attention`
- **Params:** `session_id` (optional), `files` (required array), `source_agent` (optional)
- **Behavior:** Posts warning annotations for each flagged file to highlight them for human review.

## Server Interaction

All tools that need the server use `ensureServer()` from `@diffprism/core` to auto-start the daemon if not running. Module-level state (`lastGlobalSessionId`, `lastGlobalServerInfo`) tracks the active session across tool calls.

## Critical: Stdio Safety

The MCP protocol runs over stdio. Any stdout output corrupts the protocol. The `ensureServer()` call uses `silent: true` and the daemon is spawned detached with stdout redirected to `~/.diffprism/server.log`.

## Dependencies

Runtime: `@diffprism/core`, `@diffprism/git`, `@diffprism/analysis`, `@diffprism/github`, `@modelcontextprotocol/sdk`, `zod`.

## Running

```bash
# Direct
npx tsx packages/mcp-server/src/index.ts

# Via CLI
diffprism serve

# Recommended: auto-configure Claude Code integration
npx diffprism setup
```

For manual configuration, create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "diffprism": {
      "command": "npx",
      "args": ["diffprism@latest", "serve"]
    }
  }
}
```
