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

This tells Claude Code to start DiffPrism's MCP server, which exposes 9 review tools.

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
      "mcp__diffprism__update_review_context",
      "mcp__diffprism__get_review_result",
      "mcp__diffprism__get_diff",
      "mcp__diffprism__analyze_diff",
      "mcp__diffprism__add_annotation",
      "mcp__diffprism__get_review_state",
      "mcp__diffprism__flag_for_attention",
      "mcp__diffprism__review_pr"
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

The MCP server exposes 9 tools:

### `open_review`

Opens a browser-based code review. Blocks until the engineer submits their decision. Auto-starts the DiffPrism server daemon if not running.

| Parameter     | Required | Description                                                       |
|---------------|----------|-------------------------------------------------------------------|
| `diff_ref`    | Yes      | `"staged"`, `"unstaged"`, `"working-copy"` (staged+unstaged grouped), or a git ref range (e.g. `"HEAD~3..HEAD"`, `"main..feature"`) |
| `title`       | No       | Title displayed in the review UI                                  |
| `description` | No       | Description of the changes                                        |
| `reasoning`   | No       | Agent reasoning about why the changes were made                   |
| `annotations` | No       | Array of initial annotations to attach to the review              |

### `update_review_context`

Pushes reasoning/context to a running review session. Non-blocking — returns immediately. Requires a prior `open_review` call.

| Parameter     | Required | Description                                    |
|---------------|----------|------------------------------------------------|
| `reasoning`   | No       | Agent reasoning about the current changes      |
| `title`       | No       | Updated title for the review                   |
| `description` | No       | Updated description of the changes             |

### `get_review_result`

Fetches the most recent review result. `open_review` already blocks and returns the result — this tool is for advanced workflows where you check results separately.

| Parameter | Required | Description                                                      |
|-----------|----------|------------------------------------------------------------------|
| `wait`    | No       | If `true`, poll until a review result is available (blocks up to timeout) |
| `timeout` | No       | Max wait time in seconds when `wait=true` (default: 300, max: 600) |

### `get_diff`

Returns a structured `DiffSet` as JSON without opening a browser. Runs locally — no server needed.

| Parameter  | Required | Description                                                      |
|------------|----------|------------------------------------------------------------------|
| `diff_ref` | Yes      | Git diff reference (same options as `open_review`)               |

### `analyze_diff`

Returns a `ReviewBriefing` with summary, file triage, impact detection, complexity scores, and pattern flags. Runs locally — no server needed.

| Parameter  | Required | Description                                                      |
|------------|----------|------------------------------------------------------------------|
| `diff_ref` | Yes      | Git diff reference (same options as `open_review`)               |

### `add_annotation`

Posts a structured finding to a review session.

| Parameter      | Required | Description                                              |
|----------------|----------|----------------------------------------------------------|
| `session_id`   | Yes      | Review session ID from `open_review`                     |
| `file`         | Yes      | File path within the diff to annotate                    |
| `line`         | Yes      | Line number to annotate                                  |
| `body`         | Yes      | The annotation text                                      |
| `type`         | Yes      | `"finding"`, `"suggestion"`, `"question"`, or `"warning"` |
| `confidence`   | No       | 0-1 confidence score (default: 1)                        |
| `category`     | No       | Category: security, performance, convention, etc.        |
| `source_agent` | No       | Agent identifier (e.g., 'security-reviewer')             |

### `get_review_state`

Returns session metadata, status, and annotations.

| Parameter    | Required | Description                                                  |
|--------------|----------|--------------------------------------------------------------|
| `session_id` | No       | Review session ID. Defaults to the most recently created session. |

### `flag_for_attention`

Marks files for human attention by posting warning annotations.

| Parameter      | Required | Description                                              |
|----------------|----------|----------------------------------------------------------|
| `session_id`   | No       | Review session ID. Defaults to most recent.              |
| `files`        | Yes      | Array of `{ path, reason, line? }` objects               |
| `source_agent` | No       | Agent identifier                                         |

### `review_pr`

Opens a browser-based code review for a GitHub pull request. Optionally posts the review back to GitHub.

| Parameter        | Required | Description                                              |
|------------------|----------|----------------------------------------------------------|
| `pr`             | Yes      | `"owner/repo#123"` or `"https://github.com/owner/repo/pull/123"` |
| `title`          | No       | Override review title                                    |
| `reasoning`      | No       | Agent reasoning about the PR changes                     |
| `post_to_github` | No       | Post the review back to GitHub after submission (default: false) |

### ReviewResult (return type)

**Returned by** `open_review`, `get_review_result`, and `review_pr`:

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
