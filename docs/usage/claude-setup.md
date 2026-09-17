# Setting Up Claude to Use DiffPrism

This guide walks you through configuring Claude Code and Claude Desktop to use DiffPrism as an MCP (Model Context Protocol) tool for code review.

## Prerequisites

- **Node.js >= 20** — DiffPrism requires Node 20 or later
- **Git** — must be available on your PATH (DiffPrism shells out to `git diff`)
- **A git repository** — DiffPrism operates on local git diffs, so run it inside a repo

## Quick Setup (Recommended)

Run this from your project root:

```bash
npx diffprism setup
```

This single command:
- Adds `.diffprism` to `.gitignore`
- Creates `.mcp.json` with the DiffPrism MCP server config
- Creates `.claude/settings.json` with auto-approve permissions for all DiffPrism MCP tools
- Installs the `/review` skill so you can type `/review` in Claude Code at any time

After running, restart Claude Code to pick up the new configuration.

**Options:**
- `--global` — Configure globally (skill + permissions at `~/.claude/`, no git repo required). Skips per-project configs (.mcp.json, .gitignore).
- `--force` — Overwrite existing configuration files

**Global setup** is useful when running `diffprism server` for multi-session reviews. It installs the skill and permissions once, then you only need `diffprism setup` (without `--global`) per project for the `.mcp.json` entry.

## Manual Setup

If you prefer to configure things manually, follow the steps below.

### Step 1: Install DiffPrism

**Option A: Use via npx (no install needed)**

```bash
npx diffprism review --staged
```

This downloads and runs DiffPrism on demand. Works for both CLI and MCP usage.

**Option B: Install globally**

```bash
npm install -g diffprism
```

**Option C: Local development (contributors)**

```bash
git clone https://github.com/CodeJonesW/diffprism.git
cd diffprism
pnpm install
```

### Step 2: Configure the MCP Server

#### Claude Code

Create or edit `.mcp.json` in your project root:

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

This tells Claude Code to start DiffPrism's MCP server, which exposes 14 review tools.

> **Local dev setup:** If you cloned the repo and want to run from source, use:
> ```json
> {
>   "mcpServers": {
>     "diffprism": {
>       "command": "npx",
>       "args": ["tsx", "/absolute/path/to/diffprism/cli/src/index.ts", "serve"]
>     }
>   }
> }
> ```

#### Claude Desktop

Edit the Claude Desktop config file:

| OS      | Config path                                                        |
|---------|--------------------------------------------------------------------|
| macOS   | `~/Library/Application Support/Claude/claude_desktop_config.json`  |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json`                      |
| Linux   | `~/.config/Claude/claude_desktop_config.json`                      |

Add the `diffprism` entry under `mcpServers`:

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

Restart Claude Desktop after saving.

### Step 3: Auto-Approve Tools (Optional)

By default, Claude Code prompts for confirmation each time an MCP tool is called. To skip the prompt, add the tools to your permissions allowlist.

**Project-level** (`.claude/settings.json` in your repo root):

```json
{
  "permissions": {
    "allow": [
      "mcp__diffprism__open_review",
      "mcp__diffprism__get_review_result",
      "mcp__diffprism__update_review_context",
      "mcp__diffprism__get_diff",
      "mcp__diffprism__analyze_diff",
      "mcp__diffprism__annotate",
      "mcp__diffprism__get_review_comments",
      "mcp__diffprism__get_review_state",
      "mcp__diffprism__get_user_focus",
      "mcp__diffprism__get_pr_context",
      "mcp__diffprism__get_file_diff",
      "mcp__diffprism__get_file_context"
    ]
  }
}
```

**User-level** (`~/.claude/settings.json`):

Same format, but applies to all projects.

Commit the project-level file to your repo so your whole team gets the same config.

### Step 4: Verify the Setup

Once configured, ask Claude to run a review:

```
Review my staged changes with diffprism
```

Or be explicit:

```
Use the open_review tool with diff_ref "HEAD~1..HEAD" and title "Test review"
```

Claude will call the `open_review` MCP tool. The DiffPrism server auto-starts as a background daemon if not already running, then opens the review UI in the browser. Submit a review decision (Approve / Request Changes / Approve with Comments / Dismiss), and the result is returned to Claude as structured JSON. You can also use the quick action menu to Approve & Commit or Approve, Commit & PR in one step.

## Tool Reference

The MCP server exposes 12 tools.

**Reviews are one per repo.** Opening a review for a repo that already has one updates that session — new diff, same id, annotations kept. A git worktree counts as its own repo.

**Targeting.** Every tool that acts on an open review accepts:

| Parameter    | Required | Description |
|--------------|----------|-------------|
| `session_id` | No       | The review to act on. Takes precedence over `repo_path`. |
| `repo_path`  | No       | Any directory inside the repo whose review to act on. Defaults to the directory the MCP server runs in. |

If neither resolves to exactly one open review, the tool returns an error — listing the candidates when there are several — instead of guessing.

### `open_review`

Opens a review of local changes and **blocks until the reviewer decides**, returning the `ReviewResult`. Auto-starts the DiffPrism server daemon if needed. Does not open pull requests — use `diffprism review <PR URL>` or the dashboard for those.

| Parameter     | Required | Description |
|---------------|----------|-------------|
| `diff_ref`    | Yes      | `"working-copy"` (staged + unstaged, grouped), `"staged"`, `"unstaged"`, or a ref range (e.g. `"HEAD~3..HEAD"`) |
| `title`       | No       | Title displayed in the review UI |
| `description` | No       | Description of the changes |
| `reasoning`   | No       | What the agent was trying to accomplish; shown as the session subtitle |
| `annotations` | No       | Findings to attach when the review opens (same shape as `annotate`) |
| `wait`        | No       | Wait for the decision (default `true`). `false` returns `{ status: "open", sessionId }` at once. |
| `timeout_ms`  | No       | How long to wait (default 600000). On expiry returns `{ status: "timed_out", sessionId }`; the review stays open. |

### `get_review_result`

Checks the decision on a review that is already open — after `wait: false`, or after a timeout. Returns the `ReviewResult`, or `{ status: "pending" }`.

| Parameter | Required | Description |
|-----------|----------|-------------|
| targeting | No       | See above |
| `wait`    | No       | Block until a decision arrives |
| `timeout` | No       | Max wait in seconds when `wait` is true (default 300, max 600) |

### `update_review_context`

Pushes reasoning, title, or description to an open review. Returns immediately.

| Parameter     | Required | Description |
|---------------|----------|-------------|
| targeting     | No       | See above |
| `reasoning`   | No       | Agent reasoning about the current changes |
| `title`       | No       | Updated title |
| `description` | No       | Updated description |

### `get_diff`

Returns a structured `DiffSet` as JSON. Runs locally — no server needed.

| Parameter  | Required | Description |
|------------|----------|-------------|
| `diff_ref` | Yes      | Same options as `open_review` |

### `analyze_diff`

Returns a `ReviewBriefing`: summary, file triage, impact detection, complexity scores, and pattern flags. Runs locally — no server needed.

| Parameter  | Required | Description |
|------------|----------|-------------|
| `diff_ref` | Yes      | Same options as `open_review` |

### `annotate`

Posts one or more findings to an open review. `warning` annotations flag the session for attention in the sidebar. Replaces `add_annotation`, `add_review_comment`, and `flag_for_attention`.

| Parameter      | Required | Description |
|----------------|----------|-------------|
| targeting      | No       | See above |
| `annotations`  | Yes      | Array of `{ file, line?, body, type, confidence?, category? }`. `type` is `finding`, `suggestion`, `question`, or `warning`; `line` defaults to 1. |
| `source_agent` | No       | Who posted these, e.g. `security-reviewer` |

Returns `{ sessionId, annotationIds, failed? }`. Partial failures are listed in `failed`; the call is an error only if nothing was posted.

### `get_review_comments`

Every comment and annotation on an open review. Takes targeting.

### `get_review_state`

Session summary — status, decision, `diffRef`, `hasNewChanges`, `needsAttention` — plus annotations. Takes targeting.

### `get_user_focus`

The file and line range the reviewer is currently looking at. Takes targeting.

### `get_pr_context`

For a PR review: metadata (title, author, branches, URL), briefing summary, file list, and whether a local clone is connected. Takes targeting.

### `get_file_diff`

Hunks for one file, with its triage category.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `file`    | Yes      | File path within the diff |
| targeting | No       | See above |

### `get_file_context`

Full file content from the local clone via `git show`, at the PR's head branch by default.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `file`    | Yes      | Path relative to the repo root |
| `ref`     | No       | Git ref to read from |
| targeting | No       | See above |

### ReviewResult (return type)

**Returned by** `open_review` and `get_review_result`:

```json
{
  "decision": "approved",
  "comments": [],
  "fileStatuses": {},
  "summary": ""
}
```

- `decision` — one of: `approved`, `changes_requested`, `approved_with_comments`, or `dismissed`
- `comments` — array of `{ file, line, body, type }` where type is `must_fix`, `suggestion`, `question`, or `nitpick`
- `fileStatuses` — (optional) map of file path to review status (`unreviewed`, `reviewed`, `approved`, `needs_changes`)
- `summary` — (optional) free-text summary from the reviewer
- `postReviewAction` — (optional) `"commit"` or `"commit_and_pr"` — set when the user selects a quick action from the review UI

## The `/review` Skill

If you ran `npx diffprism setup`, the `/review` skill is already installed. Type `/review` in Claude Code to open a DiffPrism review at any time.

## Adding DiffPrism to Your CLAUDE.md

If you prefer manual configuration over the `/review` skill, add instructions to your project's `CLAUDE.md`:

```markdown
## Code Review

Before committing changes, use the diffprism MCP tool to open a review:
- Call `open_review` with the appropriate `diff_ref` (e.g. `"staged"`, `"HEAD~1..HEAD"`)
- Include a `title` and `description` summarizing the changes
- Wait for the user's review decision before proceeding
```

This ensures Claude treats code review as part of its workflow rather than something you have to remember to ask for.

## Troubleshooting

### Tool not found / MCP server not starting

- Verify `npx diffprism serve` works from the command line in your project directory
- Check that the `.mcp.json` file is in the project root (not a subdirectory)
- For Claude Desktop, confirm the config file path matches your OS (see table above)
- Restart Claude Code or Claude Desktop after changing MCP config

### Browser doesn't open

- The DiffPrism server calls `open` to launch the default browser. In headless environments (SSH, containers), this will fail
- The server logs the URL to `~/.diffprism/server.log` — you can open it manually
- Check firewall rules if the server port (24680) is blocked

### Review hangs / never completes

- DiffPrism blocks until you submit a review in the browser UI. If the browser tab was closed, the tool will eventually time out
- Check `~/.diffprism/server.log` for errors
- Run `diffprism server status` to verify the server is running

### Stdio corruption (MCP mode)

- DiffPrism's MCP server uses `ensureServer()` with `silent: true` to prevent stdout output from corrupting the protocol
- If you see garbled JSON errors from Claude, check that nothing else is writing to stdout in the MCP server process
- Do not add `console.log` calls in MCP server code paths
