# DiffPrism

Your AI writes code — you need to review it before it ships. But terminal diffs
are hard to read, and there's no way to leave structured feedback that the agent
actually acts on.

DiffPrism opens a code review UI in your browser with syntax-highlighted diffs,
inline commenting, and structured decisions (approve / request changes) that
Claude reads and responds to.

## How It Works

1. Type `/review` in Claude Code — your browser opens with the diff
2. Review the changes, leave inline comments, approve or request changes
3. Claude reads your decision and acts on it (commits, opens a PR, or fixes what you flagged)

## Setup for Claude Code

```bash
npx diffprism setup
```

Configures everything and opens a demo review so you can see it in action. Restart Claude Code afterward to load the MCP server.

## Use from the CLI

No setup needed — just run:

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
