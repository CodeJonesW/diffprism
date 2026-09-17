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
  → calls annotate → annotation appears on the diff in your browser
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

DiffPrism exposes 14 MCP tools to your AI.

Reviews are **one per repo**: opening a review for a repo that already has one updates it instead of starting another, and keeps its annotations. Tools that work on an open review act on the one for the repo your AI is running in, or take `session_id` / `repo_path` — and if that's ambiguous they say so rather than guess.

### Opening and deciding
| Tool | Purpose |
|------|---------|
| `open_review` | Open a review of local changes and **wait for the decision** (`wait: false` to return at once) |
| `get_review_result` | Check the decision on a review already open |
| `update_review_context` | Push updated reasoning/description to an open review |

### Analysis
| Tool | Purpose |
|------|---------|
| `analyze_diff` | Returns analysis JSON (patterns, complexity, test gaps) |
| `get_diff` | Returns structured diff JSON (file-level and hunk-level changes) |

### Working in an open review
| Tool | Purpose |
|------|---------|
| `annotate` | Post findings inline on the diff; `warning` flags the session for attention |
| `get_review_comments` | Read every thread on the session; `awaiting_reply` narrows to unanswered ones |
| `reply` | Reply to a thread — answer the reviewer's question on a line |
| `wait_for_comments` | Block until the reviewer writes something the agent hasn't answered |
| `get_review_state` | Session status, attention and new-changes flags, and annotations |
| `get_user_focus` | What file/line the user is currently viewing in the browser |
| `get_pr_context` | High-level PR overview: metadata, briefing, file list, local repo status |
| `get_file_diff` | Diff hunks for a specific file with triage category |
| `get_file_context` | Full file content from local repo via `git show` |

In a local review, **Ask agent now** in a line's comment form asks the agent while you're still reviewing: the agent's wait for your decision ends with your question, it answers in the thread, and goes back to waiting.

PR reviews are opened with `diffprism review <PR URL>` or the dashboard — not by `open_review` — and your AI then works inside them with the tools above. Click a line to ask the agent about it; an agent listening with `wait_for_comments` answers in the thread.

When you're done, **Approve**, **Request changes** or **Comment** from the bar at the bottom: DiffPrism posts it to GitHub as a pull request review. Your threads are a conversation with the agent, so none of them goes to GitHub unless you tick it; a ticked thread posts your opening message as an inline review comment. The token comes from `GITHUB_TOKEN`, `gh auth token`, or `~/.diffprism/config.json`.

## Choosing a scope

Every review — CLI, dashboard, and the MCP tools — defaults to the **working copy**.

| Scope | Shows |
|---|---|
| `working-copy` *(default)* | Everything uncommitted; staged and unstaged as separate groups |
| `staged` | Only what the next commit contains |
| `unstaged` | Only edits not yet staged |
| `HEAD~3..HEAD`, `main..feature` | A range of commits |

The one exception is the [commit gate](#commit-gate), which always reviews `staged`.

## Local Agent Review

DiffPrism also works for reviewing local agent-generated changes:

```bash
diffprism review                    # Review all changes (staged + unstaged)
diffprism review --staged           # Staged changes only
diffprism review HEAD~3             # Last 3 commits
diffprism review main..feature      # Branch diff
```

Running multiple Claude Code sessions? All reviews appear in one browser dashboard with status badges, branch info, and desktop notifications.

## Commit Gate

Review is only reliable if something other than memory triggers it. `diffprism hook`
wires the review into your pre-commit hook, so a substantial change opens a review
before it can land.

```bash
diffprism hook install              # Add the gate to this repo's pre-commit hook
diffprism hook uninstall            # Remove it
```

If you ask the agent something while the commit waits, the commit stops and prints each question with the command that answers it (`diffprism reply --session <id> <annotation-id> "…"`). The agent answers, commits again, and the review picks up where it left off — no MCP server needed.

It reviews **staged** changes only, where every other entry point defaults to the whole
working copy: a commit contains exactly the index, so unstaged edits aren't part of what
is being approved. By default a staged diff of **120+ changed lines** opens a review; anything smaller
commits untouched. A gate that stops every commit is one you learn to skip with
`--no-verify`, and a skipped gate is worse than none. Tune it per repo:

```bash
git config diffprism.gate-lines 200
```

Approve and the commit proceeds. Request changes and the commit is blocked — with
your comments printed in the output, so the agent that ran `git commit` can read
what you asked for and fix it without another round trip:

```
140 staged lines (gate at 120) — opening DiffPrism review...

  feature.ts:12  [must_fix]  these should be a single exported record
  feature.ts:88  [question]  is this range meant to be inclusive?

Commit blocked: the review requested changes.
```

Install adds one line between markers, so uninstall removes exactly that and leaves
the rest of your hook alone. Repos using `core.hooksPath` are handled.

**Reviews take as long as they take.** An agent's shell command usually times out long
before a person finishes reading, so the review outlives the `git commit` that opened it.
A decision stands for as long as the staged diff it answered is unchanged: re-run the
same commit after the reviewer decides and it is picked up immediately, with no second
review. Agents running `git commit` should use a long shell timeout — the `/review`
skill tells them so.

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
diffprism hook install              # Gate commits on a review
diffprism hook uninstall            # Remove the gate
diffprism reply --session <id> <annotation-id> "…"  # Answer a reviewer's question, as the agent
diffprism feedback                  # Share feedback as a prefilled GitHub issue
diffprism feedback --bug            # Report a bug, including the last error
diffprism teardown                  # Remove configuration
```

## Feedback

```bash
diffprism feedback                 # Share an idea or what's working
diffprism feedback --bug           # Report a bug
diffprism feedback -m "…" --print  # Start with text; print the URL instead of opening it
```

Both open a **prefilled GitHub issue** in your browser — DiffPrism version, OS, Node, and for a bug the last error it hit, with your home directory replaced by `~`. Nothing is sent automatically and DiffPrism collects no telemetry: you read and edit the issue, then submit it or don't. The dashboard has a **Send feedback** link that does the same.

When a command fails, it says how to report it, and keeps the error in `~/.diffprism/last-error.json` so `--bug` can include it.

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
