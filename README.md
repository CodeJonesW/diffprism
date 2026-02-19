# DiffPrism

Local-first code review tool for agent-generated code changes. Opens a browser-based diff viewer from the CLI or Claude Code (via MCP).

DiffPrism gives you a visual review step for AI-written code — stage your changes, run the tool, and a browser window opens with a syntax-highlighted diff viewer. Approve or request changes, and the result is returned as structured JSON.

## Quick Start

```bash
# Clone and install
git clone <repo-url> && cd diffprism
pnpm install

# Review staged changes
pnpm cli review --staged
```

A browser window opens with the diff viewer. Click **Approve** or **Request Changes**, and the result prints to stdout as JSON.

## Usage

### CLI

```bash
# Review staged changes (default)
pnpm cli review
pnpm cli review --staged

# Review unstaged changes
pnpm cli review --unstaged

# Review a specific ref range
pnpm cli review HEAD~3
pnpm cli review main..feature-branch

# Add a title to the review
pnpm cli review --staged --title "Add auth middleware"
```

**Output:** A `ReviewResult` JSON object:

```json
{
  "decision": "approved",
  "comments": [],
  "summary": ""
}
```

Decisions are one of: `approved`, `changes_requested`, or `approved_with_comments`.

### Claude Code (MCP)

DiffPrism ships an MCP server so Claude Code can open reviews during a coding session.

**Setup:** Add to your Claude Code MCP config (`.mcp.json` or project settings). See the [full setup guide](docs/claude-setup.md) for detailed instructions covering Claude Code, Claude Desktop, auto-approval, and troubleshooting.

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

**Tool:** `open_review`

| Parameter     | Required | Description                          |
|---------------|----------|--------------------------------------|
| `diff_ref`    | yes      | Git diff reference: `"staged"`, `"unstaged"`, or a ref range |
| `title`       | no       | Title shown in the review UI         |
| `description` | no       | Description of the changes           |
| `reasoning`   | no       | Agent reasoning about why changes were made |

The tool opens a browser, blocks until you submit a review, and returns the `ReviewResult` to Claude Code.

**Auto-approve the tool:** By default Claude Code prompts for confirmation each time. To skip that, add `mcp__diffprism__open_review` to the `permissions.allow` array in your project's `.claude/settings.json` or your user-level `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__diffprism__open_review"
    ]
  }
}
```

## How It Works

1. **Extract** — runs `git diff` and parses the output into a structured `DiffSet`
2. **Analyze** — generates a `ReviewBriefing` with file stats, impact detection, and triage
3. **Serve** — starts a Vite dev server (React UI) and WebSocket bridge on random ports
4. **Review** — opens a browser to the diff viewer, waits for your decision
5. **Return** — cleans up servers and returns the `ReviewResult`

## Development

```bash
pnpm install                                    # Install all deps
pnpm test                                       # Run all tests (Vitest)
npx tsc --noEmit -p packages/core/tsconfig.json # Type-check a package
```

### Project Structure

```
packages/core       — Shared types, pipeline orchestrator, WebSocket bridge
packages/git        — Git diff extraction + unified diff parser
packages/analysis   — Deterministic review briefing generation
packages/ui         — React 19 + Vite + Tailwind diff viewer
packages/mcp-server — MCP tool server (open_review)
packages/github     — Placeholder (future GitHub integration)
cli/                — Commander CLI entry point
```

### Requirements

- Node.js >= 20
- pnpm
- Git
