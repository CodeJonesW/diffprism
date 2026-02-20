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

## Multi-Agent / Worktree Support (Future)

Early thinking — not fully specced yet. The core idea: developers using git worktrees to run multiple agents in parallel need DiffPrism to clearly surface **which branch and worktree** each review belongs to, and support reviewing multiple agent outputs simultaneously.

### Problem
- A developer may have 3-4 agents working on separate branches in separate worktrees at the same time
- When multiple review windows open, it's easy to lose track of which review is for which agent/branch/worktree
- The current UI doesn't prominently display branch or worktree context

### Ideas to Explore
- **Branch + worktree identification in the review UI** — show the branch name, worktree path, and possibly the agent identity prominently in the header
- **Multi-review dashboard** — a single view that lists all active/pending reviews across worktrees, so the dev can triage and switch between them
- **Review queuing** — if multiple agents finish at similar times, queue reviews rather than opening N browser tabs
- **Worktree-aware MCP** — the MCP server could detect it's running inside a worktree and include that context in the review metadata
- **Color coding or visual differentiation** — give each branch/worktree a distinct visual indicator so reviews are instantly distinguishable
- **Review session grouping** — group reviews by project or sprint so the developer sees the full picture of what agents have produced

### Open Questions
- What metadata does the developer actually need to confidently review agent output? Branch name alone, or also commit range, agent identity, task description?
- Should reviews be serialized (one at a time) or is true parallel review valuable?
- How should completed reviews flow back to agents waiting in different worktrees?
- What does the ideal "morning standup" view look like — reviewing everything agents did overnight across worktrees?

---

## Pain Points & Open Questions

- (Capture friction points from real usage sessions here)

---

## Design Principles

1. **Zero-config for common cases** — sensible defaults, flags for overrides
2. **Fast feedback loop** — browser opens immediately, result returns as JSON
3. **Local-first** — no accounts, no cloud, everything runs on the user's machine
4. **Agent-friendly** — structured input/output, MCP integration, silent mode for automation
