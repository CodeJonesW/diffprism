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

**1. Add the MCP server** — create `.mcp.json` in your project root:

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

**2. Auto-approve the tool** (optional) — add to `.claude/settings.json` so Claude can open reviews without prompting:

```json
{
  "permissions": {
    "allow": [
      "mcp__diffprism__open_review"
    ]
  }
}
```

**3. Tell Claude to use it** — add to your project's `CLAUDE.md`:

```markdown
## Code Review

Before committing changes, use the diffprism MCP tool to open a review:
- Call `open_review` with the appropriate `diff_ref` (e.g. `"staged"`, `"HEAD~1..HEAD"`)
- Include a `title` and `description` summarizing the changes
- Wait for the user's review decision before proceeding
```

That's it. Claude will now open a browser-based review before committing. You review the diff, leave comments, and the result goes back to Claude as structured JSON.

See the [full setup guide](docs/claude-setup.md) for Claude Desktop config, troubleshooting, and advanced options.

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

## MCP Tool Reference

The MCP server exposes one tool: **`open_review`**

| Parameter     | Required | Description                                                       |
|---------------|----------|-------------------------------------------------------------------|
| `diff_ref`    | Yes      | `"staged"`, `"unstaged"`, or a git ref range (e.g. `"HEAD~3..HEAD"`, `"main..feature"`) |
| `title`       | No       | Title displayed in the review UI                                  |
| `description` | No       | Description of the changes                                        |
| `reasoning`   | No       | Agent reasoning about why the changes were made (shown in the reasoning panel) |

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
