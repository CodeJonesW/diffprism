# @diffprism/mcp-server

MCP (Model Context Protocol) server exposing DiffPrism tools to Claude Code and other MCP clients.

## Key Files

- `src/index.ts` — `startMcpServer()` creates an McpServer, registers the `open_review` tool, connects StdioServerTransport.

## Tools

### `open_review`
- **Params:** `diff_ref` (required), `title`, `description`, `reasoning` (all optional)
- **Behavior:** Calls `startReview()` with `silent: true`, blocks until user submits review in browser
- **Returns:** `ReviewResult` as JSON text content

## Critical: Stdio Safety

The MCP protocol runs over stdio. Any stdout output from the pipeline corrupts the protocol. This is why `silent: true` is passed to `startReview()`, which sets Vite to `logLevel: "silent"` and suppresses all console.log calls.

## Running

```bash
# Direct
npx tsx packages/mcp-server/src/index.ts

# Via CLI
diffprism serve

# Claude Code config (~/.claude.json)
{
  "mcpServers": {
    "diffprism": {
      "command": "npx",
      "args": ["tsx", "/path/to/diffprism/cli/src/index.ts", "serve"]
    }
  }
}
```
