# @diffprism/mcp-server

MCP (Model Context Protocol) server exposing DiffPrism tools to Claude Code and other MCP clients.

## Key Files

- `src/index.ts` — `startMcpServer()` creates an McpServer, registers 14 tools, connects StdioServerTransport.

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

### Super Review Tools

These tools enable AI-powered PR review. The user opens a GitHub PR in the DiffPrism UI, then uses Claude Code / Cursor to interrogate the changes via these MCP tools.

### `get_pr_context`
- **Params:** `session_id` (optional, defaults to most recent)
- **Behavior:** Returns high-level PR overview: metadata (title, author, branches, URL), briefing summary, file list with stats, local repo path, and whether a local repo is connected.

### `get_file_diff`
- **Params:** `file` (required), `session_id` (optional)
- **Behavior:** Returns the diff hunks for a specific file from the active review session, plus its triage category (critical/notable/mechanical).

### `get_file_context`
- **Params:** `file` (required), `ref` (optional), `session_id` (optional)
- **Behavior:** Returns full file content from the local repo via `git show`. Uses the PR's head branch ref by default. Falls back to working tree if git show fails. Requires server to be running from within the repo clone.

### `add_review_comment`
- **Params:** `file` (required), `line` (required), `body` (required), `type` (optional: "comment"/"suggestion"/"concern"), `session_id` (optional)
- **Behavior:** Posts a comment to the active review session. Appears as an inline annotation in the DiffPrism browser UI in real-time.

### `get_review_comments`
- **Params:** `session_id` (optional)
- **Behavior:** Returns all comments and annotations on the active review session.

### `get_user_focus`
- **Params:** `session_id` (optional)
- **Behavior:** Returns which file and line range the user is currently viewing in the DiffPrism UI. The UI reports focus state to the server automatically.

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
