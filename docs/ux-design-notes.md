# UX Design Notes

Living document capturing user experience observations, design decisions, and expected behavior for DiffPrism. Updated continuously as the tool evolves.

---

## CLI Defaults

### Default diff scope (v0.2.6)
- **Decision:** `diffprism review` with no flags defaults to `"all"` (staged + unstaged via `git diff HEAD`)
- **Rationale:** Most users edit files and run the review without staging first. Defaulting to `"staged"` caused "No changes to review" confusion. Explicit `--staged` and `--unstaged` flags still available for narrower scope.
- **Issue:** [#6](https://github.com/CodeJonesW/diffprism/issues/6)

---

## Review UI

### Current state (M0)
- Dark mode only, GitHub dark theme colors
- Unified diff view with syntax highlighting (refractor)
- Two actions: Approve / Request Changes
- No inline commenting yet

### Observations
- (Add observations here as they arise from real usage)

---

## MCP Integration

### Setup simplicity (v0.2.x)
- Published to npm so MCP config is just `npx diffprism serve` — no cloning, no path dependencies
- `silent: true` is critical to prevent stdout from corrupting MCP stdio protocol

### One-command setup (v0.11.x)
- **Decision:** Added `diffprism setup` command that configures `.mcp.json`, `.claude/settings.json`, and installs a `/review` skill in one step
- **Rationale:** The previous setup required 3 manual steps (create `.mcp.json`, edit `.claude/settings.json`, add instructions to `CLAUDE.md`). Users found this friction-heavy. A single `npx diffprism setup` reduces onboarding to one command.
- **Design:** The setup command is non-interactive and idempotent — it merges into existing config files rather than overwriting, and skips files that are already correctly configured. The `--force` flag overrides skip behavior.
- **Skill-based integration:** Instead of requiring users to add instructions to `CLAUDE.md`, we install a `/review` skill that Claude discovers automatically. This is more discoverable (shows up in Claude Code's skill list) and keeps `CLAUDE.md` cleaner.

### First-run onboarding via skill
- **Decision:** Preferences (`reviewTrigger`, `defaultDiffScope`, `includeReasoning`) are gathered conversationally by Claude on first `/review` invocation, not by the setup command
- **Rationale:** Keeps `diffprism setup` non-interactive (can run in scripts/CI), while letting Claude ask the right questions in context. Users can re-trigger onboarding by deleting `diffprism.config.json`.
- **Config location:** `diffprism.config.json` lives at project root (not inside `.claude/`) so it can be committed and shared with the team

---

## Watch Mode (v0.13.x)

### Decision
Added `diffprism watch` command — a persistent watcher that keeps a browser tab open and auto-refreshes diffs + analysis as files change. Designed to eliminate the manual friction of asking Claude to open a review.

### Architecture
- **Two-port model:** WS+HTTP bridge on one port (API + WebSocket), Vite/static UI server on a second port
- **Polling-based:** Polls `getDiff()` every 1s, SHA-256 hashes rawDiff to detect changes, only pushes updates when the hash changes
- **Service discovery:** Writes `.diffprism/watch.json` at the git root with `{ wsPort, uiPort, pid, cwd, diffRef, startedAt }`. MCP tools and CLI commands read this to find the running watch server. Stale files are cleaned up via PID liveness check.
- **Claude Code integration:**
  - `update_review_context` MCP tool — pushes reasoning to the watch session without blocking
  - `notify-stop` CLI command — fire-and-forget POST to `/api/refresh`, used as a Claude Code Stop hook
  - `/review` skill detects running watch and calls `update_review_context` instead of blocking `open_review`

### UX Behavior
- **After submit:** Watch mode shows "Watching for changes..." instead of countdown + auto-close. When new diff arrives, transitions back to review view.
- **State preservation:** File review statuses are preserved for unchanged files. Only changed files reset to "unreviewed". Comments are kept.
- **Visual indicator:** Green pulsing dot in top-right corner shows "Watching" when in watch mode.
- **Graceful shutdown:** SIGINT/SIGTERM stops the watcher, cleans up `.diffprism/watch.json`, closes servers.

### Setup
`diffprism setup` now also:
- Auto-approves `mcp__diffprism__update_review_context` tool
- Adds a Claude Code Stop hook (`npx diffprism notify-stop`) to trigger refresh after every Claude turn

---

## Global Server & Multi-Session UI (v0.15.0–v0.16.0)

### Decision
Added `diffprism server` — a persistent global server that accepts reviews from multiple Claude Code sessions and displays them in a single browser tab. Replaces the pattern of opening a new browser tab per `open_review` call.

### Architecture
- **Global server** (`startGlobalServer()`): HTTP API on port 24680, WebSocket on port 24681. Manages sessions in memory. Writes `~/.diffprism/server.json` for discovery.
- **MCP auto-detection**: MCP server reads `~/.diffprism/server.json`, checks PID liveness + HTTP ping. If alive, computes diff locally and POSTs payload to `/api/reviews` instead of running the pipeline in-process. Polls `/api/reviews/:id/result` for the review decision.
- **Multi-session UI**: `SessionList` component shows all active reviews with title, branch, file count, +/- stats, status badges (pending/in_review/submitted). Click to switch. Auto-selects when only one session exists.
- **Global setup** (`diffprism setup --global`): Installs skill and permissions at `~/.claude/` paths without requiring a git repo. `diffprism server` auto-runs this if not done.

### UX Behavior
- **Session list**: In server mode (`serverMode=true` URL param), the UI shows a session list instead of a loading spinner when no review is active.
- **Auto-select**: When the global server has exactly one session, it auto-sends `review:init` without requiring a click.
- **Submission**: After submitting a review in server mode, the UI returns to the session list (watch-mode pattern) instead of countdown + close.
- **Backwards compatible**: Without a global server, all tools work exactly as before (ephemeral browser tab per review).

### WS Protocol Additions
- Server → Client: `session:list` (all sessions), `session:added` (new session notification)
- Client → Server: `session:select` (user clicks a session)

## Multi-Agent / Worktree Support (Remaining)

The global server handles the core multi-agent use case. Remaining work:

### Still to Explore
- **Worktree detection** — detect when MCP is running inside a git worktree and include worktree path, branch, and agent context in session metadata (#45)
- **Per-session live watching** — each session in the global server polls for diff changes, updating live without a new `open_review` call
- **Color coding or visual differentiation** — give each branch/worktree a distinct visual indicator so reviews are instantly distinguishable

### Resolved Questions
- **Metadata needed**: Branch name, project path, file count, +/- stats, and review status are sufficient for triage. Agent identity can be added later.
- **Serialized vs parallel**: Sessions are listed, user picks which to review. True parallel review (split-screen) is future work.
- **Review flow back to agents**: MCP polls `/api/reviews/:id/result` — the global server relays the decision back to the specific agent that posted the review.

---

## Pain Points & Open Questions

- (Capture friction points from real usage sessions here)

---

## Design Principles

1. **Zero-config for common cases** — sensible defaults, flags for overrides
2. **Fast feedback loop** — browser opens immediately, result returns as JSON
3. **Local-first** — no accounts, no cloud, everything runs on the user's machine
4. **Agent-friendly** — structured input/output, MCP integration, silent mode for automation
