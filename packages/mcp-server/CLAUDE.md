# @diffprism/mcp-server

MCP (Model Context Protocol) server exposing DiffPrism tools to Claude Code and other MCP clients.

## Key Files

- `src/index.ts` — `startMcpServer()` creates an McpServer, registers 12 tools, connects StdioServerTransport. `resolveTarget()` decides which session a tool acts on.

## Session targeting

Every tool that acts on an open review takes `session_id` and `repo_path`, and resolves in this order — never guessing:

1. `session_id`, if given.
2. `repo_path`, if given — normalised server-side to the working tree root via `GET /api/reviews/resolve`.
3. The directory the MCP server is running in, resolved the same way.
4. Otherwise an error. Zero matches names the repo; several matches (a PR review and a working-copy review can share a clone) lists the candidates and asks for `session_id`.

There is no module-level "last session" and no "most recent session across all repos" fallback. That fallback is how an agent working in one repo used to post findings into another.

## Diff scope

`open_review`, `get_diff` and `analyze_diff` share one `diff_ref` parameter — `DIFF_REF_DESCRIPTION` from core — and default to `DEFAULT_DIFF_REF` (`"working-copy"`), the same as CLI `review` and the dashboard. Self-review with `analyze_diff` and the human review it leads to therefore cover the same changes. The pre-commit hook alone uses `COMMIT_GATE_DIFF_REF` (`"staged"`), because a commit contains only the index.

## Tools

### Opening and deciding

#### `open_review`
- **Params:** `diff_ref` (default `DEFAULT_DIFF_REF`, `"working-copy"`), `title`, `description`, `reasoning`, `annotations`, `wait` (default `true`), `timeout_ms` (default `DEFAULT_WAIT_MS`, 600000)
- **Behavior:** Calls `ensureServer()` then `submitReviewToServer()`. Blocks until the reviewer decides and returns the `ReviewResult`. With `wait: false`, returns `{ status: "open", sessionId }` at once. If the wait runs out, `submitReviewToServer` throws `ReviewTimeoutError` and the tool returns `{ status: "timed_out", sessionId }` — the review is still open.
- **Rejects PR refs.** Pull requests are opened by `diffprism review <PR>` or the dashboard; agents then participate with the PR tools.
- **One session per repo:** a second open for the same repo reuses the session, keeps its annotations, switches it to the new ref, and raises its new-changes signal.
- **A decision stands while its diff is unchanged.** Re-opening with the identical diff returns a decision already given instead of clearing it — so a caller whose wait was cut short converges on the reviewer's answer. A changed diff clears it; a dismissal never carries over.
- **Why ten minutes (#161):** Claude Code aborts a stdio tool call that sends nothing for its idle window (30 min), and per-server `timeout` is a hard limit often set to 10 min. Ending the wait ourselves means the agent gets `timed_out` with a session id and instructions to keep waiting, rather than a bare client error it fills by asking the user something.

#### `get_review_result`
- **Params:** targeting, `wait`, `timeout` (seconds, default 300, max 600)
- **Behavior:** Checks an already-open review — after `open_review` with `wait: false`, or after a timeout. Returns the `ReviewResult`, or `{ status: "pending" }`.

#### `update_review_context`
- **Params:** targeting, `reasoning`, `title`, `description`
- **Behavior:** POSTs a context update to the resolved session.

### Headless analysis (no server)

#### `get_diff`
- **Params:** `diff_ref` (default `"working-copy"`)
- **Behavior:** Runs `getDiff()` locally and returns the `DiffSet`.

#### `analyze_diff`
- **Params:** `diff_ref` (default `"working-copy"`)
- **Behavior:** Runs `getDiff()` + `analyze()` locally and returns the `ReviewBriefing`.

### Working in an open review

#### `annotate`
- **Params:** targeting, `annotations` (array, min 1: `file`, `line` default 1, `body`, `type` finding/suggestion/question/warning, `confidence`, `category`), `source_agent`
- **Behavior:** POSTs each finding. Returns `{ sessionId, annotationIds, failed? }` — partial failures are reported, and the call is an error only if nothing posted. `warning` annotations raise the session's `needsAttention`.
- Replaces `add_annotation`, `add_review_comment` and `flag_for_attention`, which all wrapped the same endpoint.

#### `get_review_state`
- **Params:** targeting
- **Behavior:** Session summary (status, decision, `hasNewChanges`, `needsAttention`, `diffRef`) plus annotations.

#### `get_review_comments`
- **Params:** targeting
- **Behavior:** Every annotation and comment on the review.

#### `get_user_focus`
- **Params:** targeting
- **Behavior:** The file and line range the reviewer is looking at. The UI reports focus to the server.

#### `get_pr_context`
- **Params:** targeting
- **Behavior:** PR metadata (title, author, branches, URL), briefing summary, file list with stats, local clone path.

#### `get_file_diff`
- **Params:** `file` (required), targeting
- **Behavior:** Hunks for one file plus its triage category (critical/notable/mechanical).

#### `get_file_context`
- **Params:** `file` (required), `ref`, targeting
- **Behavior:** Full file content from the local clone via `git show`, at the PR's head branch by default, falling back to the working tree.

## Server Interaction

`open_review` uses `ensureServer()` to auto-start the daemon. Participant tools use `isServerAlive()` and report plainly when no server is running — by design a review has already been opened by then, so the server is up.

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
