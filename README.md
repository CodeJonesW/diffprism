# DiffPrism

> **This package has been deprecated.** DiffPrism has pivoted from a local CLI tool to a **GitHub App** that delivers pattern-aware code reviews directly on pull requests.

## Why the Pivot

The local review tool worked — but it required developers to install an npm package, run a background server, and switch between their terminal and a browser tab. The feedback loop was good for agent-generated code, but it didn't meet developers where they already are: **on the pull request.**

DiffPrism is now a GitHub App. Install it once, and it reviews your PRs with awareness of your codebase's existing patterns. No npm install, no CLI, no context switching. Comment `/review` on a PR and get structured inline feedback in seconds.

## What's Different

| | Before (npm package) | Now (GitHub App) |
|---|---|---|
| **Setup** | `npx diffprism setup` + restart Claude Code | Install GitHub App on your repo |
| **Trigger** | `/review` in Claude Code or CLI | `/review` comment on any PR |
| **Review location** | Separate browser tab | Inline on the PR itself |
| **Context** | Just the diff | Diff + semantically related code from your repo |
| **Pattern awareness** | None | References actual patterns from your codebase |
| **Dependencies** | Node.js, npm, background server | None — fully hosted |

## The GitHub App

DiffPrism indexes your codebase using AST-aware chunking and vector embeddings. When you request a review, it finds code patterns related to the diff and sends both to Claude. The result: reviews that can tell you "this error handling differs from the pattern in `src/api/auth.ts:42`" — not just generic correctness checks.

**The GitHub App is not yet public.** Development is happening at [CodeJonesW/diffprism-github-app](https://github.com/CodeJonesW/diffprism-github-app).

---

## Using the npm Package (Deprecated)

The local tool still works if you prefer browser-based review for agent-generated changes. It will not receive further updates.

### Setup for Claude Code

```bash
npx diffprism setup
```

Configures everything and opens a demo review. Restart Claude Code afterward to load the MCP server.

### CLI Usage

```bash
diffprism review                    # Review all changes (staged + unstaged)
diffprism review --staged           # Staged changes only
diffprism review HEAD~3             # Last 3 commits
diffprism review main..feature      # Branch diff
```

### Features

- Syntax-highlighted diffs (unified or split view)
- Inline commenting (must_fix, suggestion, question, nitpick)
- Review briefing with complexity scores and pattern flags
- Agent reasoning panel
- Quick actions — Approve & Commit or Approve, Commit & PR
- Multi-session dashboard for parallel Claude Code sessions
- Desktop notifications for new reviews
- GitHub PR review via MCP
- Keyboard shortcuts (`j`/`k` files, `n`/`p` hunks, `c` comment, `s` status, `?` help)
- Dark/light mode

### Multi-Agent Reviews

Running multiple Claude Code sessions? All reviews appear in one browser tab. The server starts automatically on first use.

```bash
diffprism server status             # Check if server is running
diffprism server stop               # Stop the background server
```

### Uninstall

```bash
npx diffprism teardown              # Remove from current project
npx diffprism teardown --global     # Remove global config
```

### Requirements

- Node.js >= 20
- Git

---

## Links

- [DiffPrism Landing Page](https://diffprism.com)
- [GitHub App Repository](https://github.com/CodeJonesW/diffprism-github-app)
