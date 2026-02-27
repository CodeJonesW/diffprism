# DiffPrism Review Workflows

Three ways to use DiffPrism with Claude Code, from simplest to most powerful.

---

## 1. Ephemeral Mode (per-review browser tab)

**Best for:** Quick one-off reviews, single agent, single repo.

### How it works

Each `/review` call opens a new browser tab, blocks until you submit, then the tab auto-closes (3s countdown). No persistent process needed.

### Setup (per repo)

```bash
cd ~/your-project
npx diffprism setup     # creates .mcp.json, .claude/settings.json, skill
# Restart Claude Code to load the MCP server
```

### Flow

1. You say `/review` in Claude Code
2. MCP `open_review` starts a temporary HTTP + WS + Vite server
3. Browser tab opens with the diff
4. You approve/request changes
5. Tab closes, servers shut down, result returns to Claude

### What `diffprism setup` creates

| File | Purpose |
|------|---------|
| `.mcp.json` | Registers `npx diffprism@latest serve` as an MCP server |
| `.claude/settings.json` | Auto-approves the 3 MCP tools + Stop hook |
| `.claude/skills/review/SKILL.md` | `/review` skill for Claude Code |
| `.gitignore` entry | Ignores `.diffprism/` directory |

---

## 2. Watch Mode (persistent local watcher)

**Best for:** Active development sessions where you want a persistent browser tab that live-updates as you work.

### How it works

A persistent watcher keeps a browser tab open, polls for git changes every 1s, and auto-refreshes the diff. After submitting a review, the UI returns to "Watching..." and picks up the next change automatically.

### Setup (per repo)

```bash
cd ~/your-project
npx diffprism start     # runs setup + starts watcher
# Restart Claude Code if first time (to load MCP server)
```

### Flow

1. `diffprism start` opens a browser tab and keeps it open
2. You edit code — diff updates live in the browser
3. `/review` in Claude Code pushes reasoning to the existing tab (does NOT open a new one)
4. You review and submit
5. Watcher resumes, waiting for the next change

### Key details

- Creates `.diffprism/watch.json` at git root — the `/review` skill detects this and uses `update_review_context` instead of `open_review`
- The Stop hook (`npx diffprism@latest notify-stop`) triggers a refresh after each Claude turn
- `Ctrl+C` to stop the watcher (cleans up `.diffprism/watch.json`)

---

## 3. Global Server Mode (multi-session, multi-agent)

**Best for:** Running multiple Claude Code agents across repos/worktrees, reviewing all changes in one browser tab.

### How it works

A single global server accepts reviews from any repo's MCP server. All reviews appear in a shared browser tab with a session list. You click into a session to review, use the back arrow to switch between sessions.

### Setup

```bash
# Start the global server (once, in any terminal)
diffprism server

# In each repo you want to review from:
cd ~/your-project
npx diffprism setup     # registers MCP server in .mcp.json
# Restart Claude Code to load the MCP server
```

### Flow

1. `diffprism server` opens a browser tab with the session list UI
2. In any repo, `/review` in Claude Code triggers `open_review`
3. MCP server detects the global server via `~/.diffprism/server.json`
4. Diff is computed locally, payload POSTed to the global server
5. Session appears in the browser tab — click to review
6. Submit review, use the back arrow (top-left) to return to session list
7. Result is polled by the MCP server and returned to Claude

### Key details

- **Discovery file:** `~/.diffprism/server.json` contains `{ httpPort, wsPort, pid, startedAt }`. The MCP server reads this to detect the global server. If missing or stale, falls back to ephemeral mode.
- **Auto-reopen:** If no browser tab is connected when a review arrives, the global server opens a new one
- **Auto-select:** When there's exactly one session, it auto-selects without showing the session list
- `diffprism server` auto-runs `diffprism setup --global` (installs skill + permissions at `~/.claude/`)
- Each repo still needs `npx diffprism setup` for the `.mcp.json` entry

### Gotchas

- If `~/.diffprism/server.json` gets deleted while the server is running, MCP servers can't detect it and fall back to ephemeral mode. Known cause: running `pnpm test` in the diffprism repo used to delete this file (fixed in v0.17.2+).
- Two `diffprism server` processes running simultaneously can compete over the discovery file. Only run one.

---

## 4. Agent Self-Review (headless analysis)

**Best for:** Agents checking their own work before requesting human review. No browser, no UI — just structured analysis data returned as JSON.

### How it works

Two headless MCP tools (`get_diff` and `analyze_diff`) let agents inspect and analyze code changes without opening a browser. The agent runs analysis, fixes issues it finds, and only opens a human review once the changes are clean.

### Setup

Same as any other mode — just run `npx diffprism setup` in your project. The headless tools are registered alongside the existing review tools.

### Flow (self-review loop)

1. Agent writes code
2. Agent calls `analyze_diff` with `diff_ref: "working-copy"`
3. ReviewBriefing comes back with patterns, complexity, test coverage gaps
4. Agent fixes issues: removes console.logs, adds missing tests, addresses security flags
5. Agent calls `analyze_diff` again to verify fixes
6. Once clean, agent calls `/review` or `open_review` for human sign-off

### Available headless tools

| Tool | Returns | Use case |
|------|---------|----------|
| `get_diff` | `DiffSet` (files, hunks, line changes) | Inspect exactly what changed |
| `analyze_diff` | `ReviewBriefing` (summary, triage, impact, patterns, complexity, test gaps) | Check for issues before human review |

### Key details

- These tools never open a browser or create a WebSocket — they're pure computation
- Same analysis engine that powers the briefing bar in the review UI
- `analyze_diff` catches: leftover console.logs, TODOs/FIXMEs, security anti-patterns (eval, innerHTML, SQL injection), disabled tests, missing test coverage, high complexity
- Works with any diff ref: `"staged"`, `"unstaged"`, `"working-copy"`, or git ranges

---

## Mode Priority

When `/review` is invoked, the system checks in order:

1. **Watch mode** — Is `.diffprism/watch.json` present and the PID alive? → Push context to watch session
2. **Global server** — Is `~/.diffprism/server.json` present and the HTTP endpoint alive? → Route to global server
3. **Ephemeral** — Fallback: start temporary servers, open a new browser tab

---

## Comparison

| | Ephemeral | Watch | Global Server |
|---|---|---|---|
| Browser tabs | New tab per review | One persistent tab | One persistent tab |
| Multi-repo | No | No | Yes |
| Multi-agent | No | No | Yes |
| Setup per repo | `diffprism setup` | `diffprism start` | `diffprism setup` |
| Global process | None | None | `diffprism server` |
| Live diff updates | No | Yes (polls 1s) | No (per `open_review` call) |
| After submit | Tab auto-closes | Resumes watching | Returns to session list |
| Desktop notifications | No | No | Yes (v0.23.0) |
| Quick actions (commit/PR) | Yes | Yes | Yes |



Deprecated on Feb 27, 2026