# DiffPrism

Browser-based code review for agent-generated changes. Review what your AI wrote before it ships.

## Try It Now

Make sure you have uncommitted changes in a git repo, then:

```bash
npx diffprism review
```

A browser window opens with a full diff viewer. Review the changes, leave inline comments, and click **Approve** or **Request Changes**. Your decision is returned as JSON.

That's the core loop. Everything below is about wiring this into your agent workflow so it happens automatically.

## Setup for Claude Code

```bash
npx diffprism setup     # run from your project root, then restart Claude Code
```

This registers DiffPrism as an MCP tool and installs the `/review` skill.

**After restarting Claude Code, you have two ways to trigger a review:**

1. **Type `/review`** — Claude opens your current changes in DiffPrism's browser UI, waits for your decision, and acts on it (e.g., commits if you approve).

2. **Ask Claude to review** — Say "review my changes" or "open a review" and Claude will call the tool.

The review blocks Claude until you submit your decision in the browser. If you request changes, Claude reads your comments and fixes them. If you approve via the quick action menu, Claude commits or opens a PR automatically.

### Try it right now

1. Ask Claude to make a small change (e.g., "add a hello world function")
2. Type `/review`
3. A browser tab opens with the diff — review it and click Approve

## Use from the CLI

```bash
diffprism review                    # Review all changes (staged + unstaged)
diffprism review --staged           # Staged changes only
diffprism review HEAD~3             # Last 3 commits
diffprism review main..feature      # Branch diff
```

## Multi-Agent Reviews

Running multiple Claude Code sessions (e.g., in git worktrees)? All reviews appear in one browser tab.

The server starts automatically on first use — no manual setup needed. Each review shows up as a session with status badges, branch info, and change stats. Click to switch between reviews. Desktop notifications alert you when new reviews arrive.

```bash
diffprism server status             # Check if server is running
diffprism server stop               # Stop the background server
```

## Features

- **Syntax-highlighted diffs** — unified or split (side-by-side) view
- **Inline commenting** — click any line to add `must_fix`, `suggestion`, `question`, or `nitpick` comments
- **Review briefing** — complexity scores, test coverage gaps, pattern flags, dependency tracking
- **Agent reasoning panel** — see why the AI made each change
- **Quick actions** — Approve & Commit or Approve, Commit & PR from the review UI
- **Multi-session dashboard** — review multiple agents from one browser tab
- **Desktop notifications** — get alerted when a new review arrives
- **GitHub PR review** — review any GitHub PR in DiffPrism's UI
- **Keyboard shortcuts** — `j`/`k` files, `n`/`p` hunks, `c` comment, `s` status, `?` help
- **Dark/light mode** — toggle with persistence

## Uninstall

```bash
npx diffprism teardown              # Remove from current project
npx diffprism teardown --global     # Remove global config
```

## Development

```bash
git clone https://github.com/CodeJonesW/diffprism.git
cd diffprism
pnpm install
pnpm test
pnpm run build
pnpm cli review --staged            # Run CLI from source
```

### Project Structure

```
packages/core       — Server, types, server-client utilities
packages/git        — Git diff extraction + parser
packages/analysis   — Deterministic review briefing
packages/ui         — React 19 + Vite 6 + Tailwind + Zustand
packages/mcp-server — MCP tool server (9 tools)
packages/github     — GitHub PR fetching + review submission
cli/                — Commander CLI
```

### Requirements

- Node.js >= 20
- Git

## Documentation

- [Claude Code Setup Guide](docs/usage/claude-setup.md) — detailed configuration and troubleshooting
- [Dev Testing Guide](docs/usage/dev-testing.md) — running from source
