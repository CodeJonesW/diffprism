# DiffPrism

Review GitHub PRs with AI superpowers. Paste a PR URL, see the diff in your browser, and use Claude Code or Cursor to interrogate every line, file, and change. Your AI gets full codebase context from your local clone — not just the diff hunks.

## How It Works

1. **Open a PR** — `diffprism review https://github.com/owner/repo/pull/123`
2. **See the diff** — Browser opens with syntax-highlighted diffs, file browser, and analysis briefing
3. **Ask your AI** — In Claude Code or Cursor, ask questions about the changes. Your AI calls MCP tools to get context and posts findings inline on the diff.

```
$ cd ~/dev/my-project
$ diffprism review https://github.com/owner/repo/pull/123
  Fetching PR #123 from owner/repo...
  Add retry logic to API client
  4 files changed
  Local repo: /Users/you/dev/my-project

  Review open in browser. Use Claude Code to ask questions about this PR.
```

Then in Claude Code:

```
> What does this PR change?
  → calls get_pr_context → high-level overview

> Is the retry logic in client.ts correct?
  → calls get_file_diff + get_file_context → full file from your local clone

> Flag line 47 as a concern
  → calls add_review_comment → annotation appears on the diff in your browser
```

## Setup

```bash
npm install -g diffprism
diffprism setup          # Register MCP server with Claude Code
```

Run the server from within your local clone so the AI gets full file context:

```bash
cd ~/dev/my-project
diffprism server         # Or let it auto-start on first review
```

## PR Review

```bash
diffprism review https://github.com/owner/repo/pull/123   # Full GitHub URL
diffprism review owner/repo#123                            # Shorthand format
```

The server auto-detects your local clone by matching `git remote -v` against the PR's repo. Your AI can then read full files via `git show` — not just diff hunks.

## MCP Tools

DiffPrism exposes 14 MCP tools to your AI:

### PR Review
| Tool | Purpose |
|------|---------|
| `get_pr_context` | High-level PR overview: metadata, briefing, file list, local repo status |
| `get_file_diff` | Diff hunks for a specific file with triage category |
| `get_file_context` | Full file content from local repo via `git show` |
| `add_review_comment` | Post a comment that appears inline on the diff in real-time |
| `get_review_comments` | Read all comments and annotations on the session |
| `get_user_focus` | What file/line the user is currently viewing in the browser |

### Review Lifecycle
| Tool | Purpose |
|------|---------|
| `open_review` | Open browser review UI for local changes or a GitHub PR |
| `get_review_result` | Fetch result from a previous review |
| `update_review_context` | Push updated reasoning/description to a running session |

### Analysis
| Tool | Purpose |
|------|---------|
| `analyze_diff` | Returns analysis JSON (patterns, complexity, test gaps) |
| `get_diff` | Returns structured diff JSON (file-level and hunk-level changes) |

### Annotation
| Tool | Purpose |
|------|---------|
| `add_annotation` | Post a structured finding on a specific line |
| `flag_for_attention` | Mark files for human attention |
| `get_review_state` | Get current state of a session including all annotations |

## Local Agent Review

DiffPrism also works for reviewing local agent-generated changes:

```bash
diffprism review                    # Review all changes (staged + unstaged)
diffprism review --staged           # Staged changes only
diffprism review HEAD~3             # Last 3 commits
diffprism review main..feature      # Branch diff
```

Running multiple Claude Code sessions? All reviews appear in one browser dashboard with status badges, branch info, and desktop notifications.

## Features

- **AI-powered PR review** — Your AI gets full codebase context via 14 MCP tools
- **Live annotations** — AI findings appear inline on the diff in real-time
- **Local repo context** — Full file content from your clone, not just diff hunks
- **No vendor lock-in** — Works with Claude Code, Cursor, or any MCP client
- **Syntax-highlighted diffs** — Unified or split view with refractor
- **Multi-session dashboard** — Review multiple agents from one browser tab
- **Review briefing** — Complexity scores, test coverage gaps, pattern flags
- **Auto-detect local repo** — Matches `git remote -v` against the PR's repo
- **Keyboard shortcuts** — `j`/`k` files, `n`/`p` hunks, `s` status, `?` help
- **Dark/light mode** — Toggle with persistence

## CLI Reference

```bash
diffprism review <ref>              # Open a review (PR URL, git ref, or flags)
diffprism setup                     # Configure Claude Code integration
diffprism setup --global            # Global setup (no git repo needed)
diffprism server                    # Start the background server
diffprism server status             # Check server status
diffprism server stop               # Stop the server
diffprism teardown                  # Remove configuration
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
packages/mcp-server — MCP tool server (14 tools)
packages/github     — GitHub PR fetching + review submission
cli/                — Commander CLI
```

### Requirements

- Node.js >= 20
- Git

## Documentation

- [Claude Code Setup Guide](docs/usage/claude-setup.md) — detailed configuration and troubleshooting
- [Dev Testing Guide](docs/usage/dev-testing.md) — running from source
