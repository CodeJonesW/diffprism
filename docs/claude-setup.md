# Setting Up Claude to Use DiffPrism

This guide walks you through configuring Claude Code and Claude Desktop to use DiffPrism as an MCP (Model Context Protocol) tool for code review.

## Prerequisites

- **Node.js >= 20** — DiffPrism requires Node 20 or later
- **Git** — must be available on your PATH (DiffPrism shells out to `git diff`)
- **A git repository** — DiffPrism operates on local git diffs, so run it inside a repo

## Step 1: Install DiffPrism

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

## Step 2: Configure the MCP Server

### Claude Code

Create or edit `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "diffprism": {
      "command": "npx",
      "args": ["diffprism", "serve"]
    }
  }
}
```

This tells Claude Code to start DiffPrism's MCP server when it needs the `open_review` tool.

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

### Claude Desktop

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
      "args": ["diffprism", "serve"]
    }
  }
}
```

Restart Claude Desktop after saving.

## Step 3: Auto-Approve the Tool (Optional)

By default, Claude Code prompts for confirmation each time the `open_review` tool is called. To skip the prompt, add the tool to your permissions allowlist.

**Project-level** (`.claude/settings.json` in your repo root):

```json
{
  "permissions": {
    "allow": [
      "mcp__diffprism__open_review"
    ]
  }
}
```

**User-level** (`~/.claude/settings.json`):

Same format, but applies to all projects.

Commit the project-level file to your repo so your whole team gets the same config.

## Step 4: Verify the Setup

Once configured, ask Claude to run a review:

```
Review my staged changes with diffprism
```

Or be explicit:

```
Use the open_review tool with diff_ref "HEAD~1..HEAD" and title "Test review"
```

Claude will call the `open_review` MCP tool. A browser window should open with the DiffPrism diff viewer. Submit a review decision (Approve / Request Changes), and the result is returned to Claude as structured JSON.

## Tool Reference

The MCP server exposes one tool: **`open_review`**

| Parameter     | Required | Description                                                       |
|---------------|----------|-------------------------------------------------------------------|
| `diff_ref`    | Yes      | `"staged"`, `"unstaged"`, or a git ref range (e.g. `"HEAD~3..HEAD"`, `"main..feature"`) |
| `title`       | No       | Title displayed in the review UI                                  |
| `description` | No       | Description of the changes                                        |
| `reasoning`   | No       | Agent reasoning about why the changes were made                   |

**Returns:** A `ReviewResult` JSON object:

```json
{
  "decision": "approved",
  "comments": [],
  "summary": ""
}
```

`decision` is one of: `approved`, `changes_requested`, or `approved_with_comments`.

## Adding DiffPrism to Your CLAUDE.md

To make Claude automatically use DiffPrism for code review, add instructions to your project's `CLAUDE.md`:

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

- DiffPrism calls `open` to launch the default browser. In headless environments (SSH, containers), this will fail
- The CLI still prints the URL — you can open it manually
- Check firewall rules if the Vite dev server port is blocked

### Review hangs / never completes

- DiffPrism blocks until you submit a review in the browser UI. If the browser tab was closed, the tool will eventually time out
- Check the terminal for WebSocket connection errors
- React HMR can cause brief disconnects — DiffPrism has a 2-second reconnect grace period

### Stdio corruption (MCP mode)

- DiffPrism runs with `silent: true` in MCP mode to prevent stdout output from corrupting the protocol
- If you see garbled JSON errors from Claude, check that nothing else is writing to stdout in the MCP server process
- Do not add `console.log` calls in MCP server code paths
