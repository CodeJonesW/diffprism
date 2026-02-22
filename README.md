# DiffPrism

Local-first code review tool for agent-generated code changes. Opens a browser-based diff viewer from the CLI or Claude Code (via MCP).

DiffPrism gives you a visual review step for AI-written code — stage your changes, run the tool, and a browser window opens with a full-featured diff viewer. Review inline, leave comments, and your decision is returned as structured JSON.

## Features

- **Syntax-highlighted diffs** — unified or split (side-by-side) view with toggle
- **Inline line-level commenting** — click any line to add comments typed as `must_fix`, `suggestion`, `question`, or `nitpick`
- **File-level review status** — mark each file as reviewed, approved, or needs changes
- **Review briefing bar** — summary stats, complexity scoring, test coverage gaps, pattern flags, and dependency tracking
- **Agent reasoning panel** — see why the AI made each change
- **Dark/light mode** — toggle with theme persistence
- **Keyboard shortcuts** — `j`/`k` navigate files, `Space`/`Enter` cycle file status
- **Three-way decisions** — approve, request changes, or approve with comments
- **Branch display** — current git branch shown in the review header

## Quick Start

### Use with Claude Code (recommended)

Run this from your project root:

```bash
npx diffprism setup
```

This single command configures everything:
- Creates `.mcp.json` with the DiffPrism MCP server
- Creates `.claude/settings.json` with auto-approve permissions
- Installs a `/review` skill so you can type `/review` in Claude Code at any time

After running, restart Claude Code. The first time you use `/review`, Claude will ask your preferences and save them to `diffprism.config.json`.

See the [full setup guide](docs/claude-setup.md) for manual configuration, Claude Desktop config, troubleshooting, and advanced options.

### Use from the CLI

```bash
# Install globally (or use npx)
npm install -g diffprism

# Review all changes (staged + unstaged, default)
diffprism review

# Review staged changes only
diffprism review --staged

# Review unstaged changes only
diffprism review --unstaged

# Review a specific ref range
diffprism review HEAD~3
diffprism review main..feature-branch

# Add a title to the review
diffprism review --staged --title "Add auth middleware"
```

A browser window opens with the diff viewer. Review the changes and click **Approve**, **Request Changes**, or **Approve with Comments**.

### Watch Mode (live-updating)

Keep a persistent browser tab that auto-refreshes as files change — ideal for reviewing while an agent is working:

```bash
# Watch staged changes, auto-refresh on every change
diffprism watch --staged

# Watch all changes with custom poll interval
diffprism watch --interval 2000

# Watch unstaged changes
diffprism watch --unstaged
```

When `diffprism watch` is running:
- The browser tab stays open and updates diffs + analysis within 1-2s of file changes
- Submit a review and it stays open, waiting for the next change
- File review statuses are preserved for unchanged files
- Claude Code's `/review` skill automatically detects the watch session and pushes reasoning without blocking

Stop the watcher with `Ctrl+C`.

## MCP Tool Reference

The MCP server exposes two tools:

### `open_review`

Opens a browser-based code review. Blocks until the engineer submits their decision.

| Parameter     | Required | Description                                                       |
|---------------|----------|-------------------------------------------------------------------|
| `diff_ref`    | Yes      | `"staged"`, `"unstaged"`, or a git ref range (e.g. `"HEAD~3..HEAD"`, `"main..feature"`) |
| `title`       | No       | Title displayed in the review UI                                  |
| `description` | No       | Description of the changes                                        |
| `reasoning`   | No       | Agent reasoning about why the changes were made (shown in the reasoning panel) |

### `update_review_context`

Pushes reasoning/context to a running `diffprism watch` session. Non-blocking — returns immediately.

| Parameter     | Required | Description                                    |
|---------------|----------|------------------------------------------------|
| `reasoning`   | No       | Agent reasoning about the current changes      |
| `title`       | No       | Updated title for the review                   |
| `description` | No       | Updated description of the changes             |

**Returns:** A `ReviewResult` JSON object:

```json
{
  "decision": "approved",
  "comments": [
    {
      "file": "src/index.ts",
      "line": 42,
      "body": "Consider adding a null check here",
      "type": "suggestion"
    }
  ],
  "summary": "Looks good, one minor suggestion."
}
```

| Field | Description |
|-------|-------------|
| `decision` | `approved`, `changes_requested`, or `approved_with_comments` |
| `comments` | Array of inline comments with file, line, body, and type (`must_fix`, `suggestion`, `question`, `nitpick`) |
| `summary` | Optional reviewer summary |

## How It Works

1. **Extract** — runs `git diff` and parses the output into a structured `DiffSet`
2. **Analyze** — generates a `ReviewBriefing`: file stats, complexity scores, test gap detection, pattern flags, dependency changes
3. **Serve** — starts a Vite dev server (React UI) and WebSocket bridge on random ports
4. **Review** — opens a browser to the diff viewer, waits for your decision
5. **Return** — cleans up servers and returns the `ReviewResult`

## Development

```bash
git clone https://github.com/CodeJonesW/diffprism.git
cd diffprism
pnpm install
pnpm test                                       # Run all tests (Vitest)
pnpm run build                                  # Build all packages
pnpm cli review --staged                        # Run CLI from source
npx tsc --noEmit -p packages/core/tsconfig.json # Type-check a package
```

### Project Structure

```
packages/core       — Shared types, pipeline orchestrator, WebSocket bridge
packages/git        — Git diff extraction + unified diff parser
packages/analysis   — Deterministic review briefing (complexity, test gaps, patterns)
packages/ui         — React 19 + Vite 6 + Tailwind + Zustand diff viewer
packages/mcp-server — MCP tool server (open_review)
cli/                — Commander CLI entry point
```

### Requirements

- Node.js >= 20
- pnpm (for development)
- Git

## Documentation

- [Claude Code / Claude Desktop Setup Guide](docs/claude-setup.md) — detailed MCP configuration, auto-approval, and troubleshooting
- [UX Design Notes](docs/ux-design-notes.md) — design decisions, CLI defaults rationale, and multi-agent workflow thinking
