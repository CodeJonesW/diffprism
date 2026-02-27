# @diffprism/mcp-server

MCP (Model Context Protocol) server exposing DiffPrism tools to Claude Code and other MCP clients.

## Key Files

- `src/index.ts` — `startMcpServer()` creates an McpServer, registers tools, connects StdioServerTransport.

## Tools

### `open_review`
- **Params:** `diff_ref` (required), `title`, `description`, `reasoning` (all optional)
- **Behavior:** Detects running global server via `isServerAlive()`. If found, computes diff locally with `getDiff()` + `analyze()`, POSTs to `/api/reviews`, then polls `/api/reviews/:id/result`. If no global server, falls back to `startReview()` with `silent: true` (ephemeral browser tab).
- **Returns:** `ReviewResult` as JSON text content. The result may include a `postReviewAction` field ('commit' or 'commit_and_pr') if the reviewer requested a post-review action via quick actions in the FileBrowser.

### `update_review_context`
- Routes to global server session if `lastGlobalSessionId` exists, otherwise falls back to watch file.

### `get_review_result`
- Polls global server if session exists, otherwise falls back to file-based result.

## Global Server Detection

Module-level state (`lastGlobalSessionId`, `lastGlobalServerInfo`) tracks the active global server session across tool calls. On each `open_review`, the MCP server checks `isServerAlive()` — reads `~/.diffprism/server.json`, checks PID, pings HTTP.

## Critical: Stdio Safety

The MCP protocol runs over stdio. Any stdout output from the pipeline corrupts the protocol. This is why `silent: true` is passed to `startReview()`, which sets Vite to `logLevel: "silent"` and suppresses all console.log calls.

## Dependencies

Runtime: `@diffprism/core`, `@diffprism/git`, `@diffprism/analysis`, `@modelcontextprotocol/sdk`, `zod`.

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
