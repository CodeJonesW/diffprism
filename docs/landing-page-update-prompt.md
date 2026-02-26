# Landing Page Update Prompt

> Paste the prompt below into Claude when working in `~/dev/diffprism-landing`.

---

I need you to update the DiffPrism landing page to reflect the latest features and product evolution. Here's the full context on what's changed.

## What DiffPrism Is

Local-first, browser-based code review tool for agent-generated changes. Opens a diff viewer from CLI or Claude Code (via MCP). No accounts, no cloud, everything runs locally.

Three operational modes:
1. **Ephemeral** — One browser tab per review, auto-closes after decision. Good for one-off reviews.
2. **Watch** — Persistent browser tab, diffs auto-update every 1s as files change. Good for active development with a single agent.
3. **Global Server (NEW)** — Persistent HTTP+WS server accepts reviews from multiple Claude Code sessions in one browser tab. Good for multi-agent workflows, worktrees, parallel sessions.

## What's New Since the Last Landing Page Update

### Major: Global Server / Multi-Session Mode (v0.15.0–v0.21.0)
This is the headline new capability. `diffprism server` starts a persistent process (HTTP port 24680 + WS port 24681) that:
- Accepts reviews from **multiple Claude Code sessions** simultaneously
- Presents a **session dashboard** in a single browser tab — showing all pending/in-review/submitted reviews with status badges, branch names, file counts, and change stats
- **Auto-routes** — MCP server detects the running global server via `~/.diffprism/server.json` and sends reviews there instead of opening ephemeral tabs
- **Auto-reopens browser** when a new review arrives and no UI clients are connected
- Session badges show **actual review decisions** (Approved / Changes Requested) with real-time updates
- `diffprism server status` shows active sessions, `diffprism server stop` shuts down gracefully

This enables the core vision: developers using git worktrees to run multiple agents in parallel, with DiffPrism as the unified review layer.

### New: Quick Actions — Approve & Commit from the Review UI (v0.24.0)
The ⋮ dropdown menu in the file browser header lets users **Approve & Commit** or **Approve, Commit & PR** directly from the review UI. The decision is returned to the agent with a `postReviewAction` field, and the agent executes the action immediately — no extra confirmation step. This closes the loop between review and commit in a single click.

### New: Desktop Notifications (v0.23.0)
When using the global server, users get **native desktop notifications** when a new review session arrives while the DiffPrism tab is backgrounded. A bell toggle in the session list header controls notifications, with preference persisted in localStorage. Clicking a notification focuses the tab and selects the session.

### New: Dismiss Reviews (v0.22.0)
A **Dismiss** button lets users close a review without approving or requesting changes — useful when the agent is still working, the review was triggered by mistake, or no feedback is needed. Dismiss unblocks MCP polling so the agent isn't left hanging.

### New: Headless Agent Tools — Agent Self-Review (v0.29.0)
Two new MCP tools let agents **analyze their own code changes** without opening a browser:
- **`get_diff`** — Returns a structured `DiffSet` (files, hunks, line-level changes) as JSON. Agents can inspect exactly what changed.
- **`analyze_diff`** — Returns a `ReviewBriefing` with summary, file triage, impact detection (affected modules, tests, dependencies, breaking changes), complexity scores, test coverage gaps, and pattern flags (security issues, console.logs, TODOs, disabled tests).

This enables the **agent self-review loop**: agent writes code → calls `analyze_diff` → fixes issues it finds (removes debug statements, adds missing tests, addresses security flags) → re-analyzes until clean → then opens a human review via `/review`. The human reviewer sees cleaner diffs because the agent already caught the obvious issues.

This is DiffPrism's first step toward **Posture 2: Agent as Self-Reviewer** — agents that proactively check their own work using the same analysis engine that powers the briefing bar in the review UI.

### Other New Features
- **Split (side-by-side) diff view** — Toggle between unified and split views
- **Dark/light mode toggle** — Was dark-only, now has a toggle with theme persistence
- **Keyboard shortcuts** — `j`/`k` navigate files, `n`/`p` navigate hunks, `c` to comment, `s` cycles file status, `?` opens hotkey guide
- **File-level status tracking** — Mark each file as reviewed/approved/needs_changes
- **Agent reasoning panel** — Collapsible panel showing why the agent made changes
- **Global setup** — `diffprism setup --global` configures at `~/.claude/` paths, no git repo required. Auto-runs on `diffprism server` start.
- **Teardown command** — `diffprism teardown` cleanly reverses all setup changes (MCP config, hooks, skill, gitignore)
- **v0.29.0 is current version**

## Current Landing Page Structure

The homepage (App.tsx) has these sections:
1. Hero — "Code review for agent-generated changes" with Watch Mode emphasis
2. Demo screenshot
3. Watch Mode comparison (Without Watch / With Watch)
4. Architecture flow diagram (Terminal → Claude Code → Browser)
5. Features grid (6 cards)
6. How It Works (3 steps: Setup, Watch, Decide)
7. CTA

The Why page (`/why`) and Blog page (`/blog`) exist as separate routes.

## What Needs to Change

### Hero Section
- Remove "Watch Mode" from the badge — it's no longer the only new thing
- Update the badge to something like "Open source · Local-first · Agent-native"
- Keep the headline: "Code review for agent-generated changes" (still accurate)
- Update the subheading to communicate the broader value prop — not just watch mode, but the full story: review agent changes in a browser UI before they become PRs, whether that's one agent or many running in parallel. Consider weaving in the self-review angle: agents that check their own work before asking you to review.

### Watch Mode Section → Modes / Multi-Agent Section
- The current Watch Mode comparison section should evolve to showcase all three modes, with the **Global Server** as the most prominent new capability
- Consider restructuring into a "Three ways to review" or "Scales with your workflow" section that shows: Ephemeral (quick one-offs) → Watch (single agent, live) → Global Server (multi-agent dashboard)
- The multi-agent story is the differentiator: "Run three Claude Code sessions in parallel. Review them all from one tab."

### Architecture Flow
- Update or add a diagram showing the global server flow: Multiple terminals/agents → DiffPrism Server → Single browser with session list
- The current Terminal → Claude Code → Browser diagram is still valid for watch mode but doesn't tell the multi-session story

### Features Grid
- Add **Multi-session dashboard** as a feature card — session list with status badges, branch info, change stats, click to switch between reviews, desktop notifications when reviews arrive
- Add **Agent self-review** as a feature card — agents analyze their own changes before requesting human review using headless MCP tools (`get_diff`, `analyze_diff`). Catches console.logs, security issues, missing tests, high complexity automatically. The self-review loop means cleaner diffs when you open the browser.
- Add **Split diff view** as a feature or mention within the existing diff viewer card
- Update existing cards if needed (e.g., the Watch Mode card could mention it's one of three modes)
- Consider adding **Keyboard navigation** as a feature card (j/k files, n/p hunks, c comment, s status, ? help)
- Add or mention **Quick actions** — Approve & Commit or Approve, Commit & PR directly from the review UI, closing the review→commit loop
- Add or mention **Dismiss** — clean exit for reviews that aren't needed, prevents agents from hanging

### How It Works
- Keep the 3-step simplicity but update step 2 to acknowledge the modes:
  - Step 1: `npx diffprism setup` (unchanged)
  - Step 2: Choose your mode — `/review` for one-shot, `diffprism watch` for live, `diffprism server` for multi-agent
  - Step 3: Decide (unchanged)

### CTA
- Update from "Ready to try Watch Mode?" to something broader — "Ready to review agent code?" or "Ready to try DiffPrism?"

## Current Install Commands
```bash
npx diffprism setup           # One-command setup for Claude Code
diffprism watch --staged      # Watch mode
diffprism server              # Global multi-session server
diffprism review              # One-shot review
diffprism teardown            # Clean removal
```

Agent self-review (via MCP — no CLI needed):
```
Agent calls analyze_diff("working-copy") → gets ReviewBriefing JSON
Agent fixes flagged issues → calls analyze_diff again → clean
Agent calls open_review for human sign-off
```

## Tone & Style Guidelines
- Keep it concise — the current copy is tight, don't bloat it
- Problem-first: lead with what the developer feels (losing context on agent changes, juggling multiple sessions)
- Emphasize local-first and zero-config
- Don't oversell features that are still in progress — stick to what's shipped
- The "Why" page and blog post don't need updates right now, just the homepage
- Maintain the existing dark theme visual style

## What NOT to Change
- Don't touch the Why page or Blog page
- Don't change the visual design system (colors, fonts, layout patterns)
- Don't remove Watch Mode content entirely — it's still a key feature, just not the only headline
- Keep the screenshot/demo section (though if you can reference the multi-session UI that would be good)
- Keep the existing GitHub/npm links

## Reference: Current Feature Set for Accuracy
- Syntax-highlighted diffs (unified + split toggle)
- Inline line-level commenting (must_fix, suggestion, question, nitpick)
- File-level status tracking (unreviewed, reviewed, approved, needs_changes)
- Review briefing bar (complexity scoring, test coverage gaps, pattern flags, dependency changes, affected modules)
- Agent reasoning display panel
- Dark/light mode toggle
- Keyboard shortcuts (j/k files, s status, ? hotkey guide)
- Four review decisions: approve, request changes, approve with comments, dismiss
- Quick action menu: Approve & Commit, Approve Commit & PR (executes post-review action without extra confirmation)
- Structured JSON results returned to agent (includes optional `postReviewAction` field)
- Multi-session dashboard with status badges, branch info, file counts, desktop notifications for new sessions
- Headless agent tools: `get_diff` (structured diff data) and `analyze_diff` (full review briefing with patterns, complexity, test gaps) — enables agent self-review loop
- MCP tools: open_review, update_review_context, get_review_result, get_diff, analyze_diff
- CLI: review, watch, serve, setup, server, teardown, start
- Zero-config: `npx diffprism setup` handles everything
- Global setup: `diffprism setup --global` for no-repo-required config
