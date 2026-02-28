# Landing Page Update Prompt

> Paste the prompt below into Claude when working in `~/dev/diffprism-landing`.

---

I need you to update the DiffPrism landing page to reflect the latest features and product evolution. Here's the full context on what's changed.

## What DiffPrism Is

Local-first, browser-based code review tool for agent-generated changes. Opens a diff viewer from CLI or Claude Code (via MCP). No accounts, no cloud, everything runs locally.

**One architecture, zero config:** A background daemon auto-starts on first use (`ensureServer()`). Every review — whether from CLI, MCP, or GitHub PR — routes through the same HTTP API. No modes to choose, no server to manually start. `npx diffprism setup` and you're done.

The server accepts reviews from **multiple Claude Code sessions** simultaneously, presenting them in a single browser tab with a session dashboard.

## What's New Since the Last Landing Page Update

### Major: Server-First Architecture (v0.35.0)
DiffPrism no longer has separate "modes." The global server **auto-starts as a background daemon** the first time any client (CLI or MCP) needs it. This replaces the previous three-mode system (ephemeral, watch, global server) with a single, unified code path:
- **Zero manual setup** — no need to run `diffprism server` first. The daemon starts automatically and persists in the background.
- **Every review goes through the server** — CLI `diffprism review`, MCP `open_review`, and `review_pr` all use the same HTTP API.
- **Logs to `~/.diffprism/server.log`** — daemon output is captured, not printed to stdout (critical for MCP stdio safety).
- The `/review` skill for Claude Code was simplified from **130 lines to 27 lines** because agents no longer need to detect modes or choose code paths.

### Major: GitHub PR Review (v0.34.0)
New `review_pr` MCP tool lets agents review GitHub pull requests in DiffPrism:
- Fetches PR diff from GitHub, normalizes to DiffPrism types, opens in the review UI
- Optionally posts the review decision back to GitHub (`post_to_github: true`)
- Works with any PR format: `owner/repo#123` or full GitHub URL

### Major: Multi-Agent Annotation Tools (v0.32.0)
Three new MCP tools enable **multi-agent review composition** — multiple specialized agents (security, performance, convention) can annotate the same review session:
- **`add_annotation`** — Post a structured finding (type, category, confidence, source agent) to a specific file and line in a review session
- **`get_review_state`** — Read current session metadata and all annotations
- **`flag_for_attention`** — Mark files that need human eyes, with reasons

These enable workflows where a security agent flags vulnerabilities, a performance agent flags N+1 queries, and a convention agent flags style issues — all appearing as annotations in the same review for the human reviewer.

### New: Quick Actions — Approve & Commit from the Review UI (v0.24.0)
The dropdown menu in the file browser header lets users **Approve & Commit** or **Approve, Commit & PR** directly from the review UI. The decision is returned to the agent with a `postReviewAction` field, and the agent executes the action immediately — no extra confirmation step. This closes the loop between review and commit in a single click.

### New: Desktop Notifications (v0.23.0)
Users get **native desktop notifications** when a new review session arrives while the DiffPrism tab is backgrounded. A bell toggle in the session list header controls notifications, with preference persisted in localStorage. Clicking a notification focuses the tab and selects the session.

### New: Dismiss Reviews (v0.22.0)
A **Dismiss** button lets users close a review without approving or requesting changes — useful when the agent is still working, the review was triggered by mistake, or no feedback is needed. Dismiss unblocks MCP polling so the agent isn't left hanging.

### New: Headless Agent Tools — Agent Self-Review (v0.29.0)
Two MCP tools let agents **analyze their own code changes** without opening a browser:
- **`get_diff`** — Returns a structured `DiffSet` (files, hunks, line-level changes) as JSON.
- **`analyze_diff`** — Returns a `ReviewBriefing` with summary, file triage, impact detection (affected modules, tests, dependencies, breaking changes), complexity scores, test coverage gaps, and pattern flags (security issues, console.logs, TODOs, disabled tests).

This enables the **agent self-review loop**: agent writes code → calls `analyze_diff` → fixes issues it finds → re-analyzes until clean → then opens a human review. The human reviewer sees cleaner diffs because the agent already caught the obvious issues.

### Other Features (shipped previously)
- **Multi-session dashboard** — Session list with status badges, branch names, file counts, change stats. Click to switch between reviews. Auto-reopens browser when a new review arrives.
- **Split (side-by-side) diff view** — Toggle between unified and split views
- **Dark/light mode toggle** — Theme toggle with persistence
- **Keyboard shortcuts** — `j`/`k` navigate files, `n`/`p` navigate hunks, `c` to comment, `s` cycles file status, `?` opens hotkey guide
- **File-level status tracking** — Mark each file as reviewed/approved/needs_changes
- **Agent reasoning panel** — Collapsible panel showing why the agent made changes
- **Global setup** — `diffprism setup --global` configures at `~/.claude/` paths, no git repo required
- **Teardown command** — `diffprism teardown` cleanly reverses all setup changes
- **v0.35.0 is current version**

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
- Remove "Watch Mode" from the badge — watch mode no longer exists as a separate concept
- Update the badge to something like "Open source · Local-first · Agent-native"
- Keep the headline: "Code review for agent-generated changes" (still accurate)
- Update the subheading to communicate the broader value prop: zero-config review for agent changes with auto-starting daemon, multi-session dashboard, multi-agent annotations, GitHub PR review, and agent self-review. Emphasize that it "just works" — no modes to choose, no server to start manually.

### Watch Mode Section → Multi-Agent / How It Works Section
- **Remove all Watch Mode content.** Watch mode no longer exists as a distinct concept. There is one architecture: the auto-starting server.
- Replace with a section showcasing the key workflows:
  1. **Single review** — Agent calls `open_review`, browser opens, you decide. Server auto-starts in the background.
  2. **Multi-agent** — Run multiple Claude Code sessions (e.g., in git worktrees). All reviews appear in one browser tab with a session dashboard.
  3. **Agent self-review** — Agents call `analyze_diff` to check their own work before requesting human review. Catches console.logs, security issues, missing tests automatically.
  4. **GitHub PR review** — Review any GitHub PR in DiffPrism's UI with full briefing and analysis.
- The multi-agent story is the differentiator: "Run three Claude Code sessions in parallel. Review them all from one tab."

### Architecture Flow
- Update the diagram to show the server-first flow: Multiple agents/CLI → auto-started DiffPrism daemon → Single browser with session dashboard
- Remove any diagrams showing separate ephemeral or watch flows — there's only one code path now

### Features Grid
- Add **Auto-start daemon** as a feature card — server starts automatically on first use, no manual `diffprism server` needed. Zero-config, zero-friction.
- Add **Multi-session dashboard** as a feature card — session list with status badges, branch info, change stats, click to switch between reviews, desktop notifications when reviews arrive
- Add **Agent self-review** as a feature card — agents analyze their own changes before requesting human review using headless MCP tools. The self-review loop means cleaner diffs when you open the browser.
- Add **GitHub PR review** as a feature card — review any GitHub PR in DiffPrism's full UI, optionally post review back to GitHub
- Add **Multi-agent annotations** as a feature card — specialized agents (security, performance, convention) can annotate the same review session with structured findings
- Add **Quick actions** — Approve & Commit or Approve, Commit & PR directly from the review UI
- Update existing cards: remove any Watch Mode card, update diff viewer card to mention split view toggle
- Consider adding **Keyboard navigation** as a feature card (j/k files, n/p hunks, c comment, s status, ? help)

### How It Works
- Simplify to two steps (it really is this simple now):
  - Step 1: `npx diffprism setup` — one command, done
  - Step 2: Use `/review` in Claude Code (or `diffprism review` from CLI). Server auto-starts, browser opens, you decide.
- Or keep three steps but make them:
  - Step 1: `npx diffprism setup`
  - Step 2: Agent writes code, optionally self-reviews with `analyze_diff`
  - Step 3: `/review` opens browser, you approve or request changes

### CTA
- Update from "Ready to try Watch Mode?" to something broader — "Ready to review agent code?" or "Start reviewing in 30 seconds"

## Current Install Commands
```bash
npx diffprism setup           # One-command setup for Claude Code
diffprism review --staged     # Review staged changes (server auto-starts)
diffprism review              # Review working copy
diffprism server status       # Check if daemon is running
diffprism server stop         # Stop the daemon
diffprism teardown            # Clean removal
```

Agent tools (via MCP — no CLI needed):
```
# Self-review loop
Agent calls analyze_diff("working-copy") → gets ReviewBriefing JSON
Agent fixes flagged issues → calls analyze_diff again → clean
Agent calls open_review for human sign-off

# Multi-agent annotations
Security agent calls add_annotation(session_id, file, line, finding)
Performance agent calls add_annotation(session_id, file, line, finding)
Human sees all findings in one review

# GitHub PR review
Agent calls review_pr("owner/repo#123") → opens PR in DiffPrism UI
```

## Tone & Style Guidelines
- Keep it concise — the current copy is tight, don't bloat it
- Problem-first: lead with what the developer feels (losing context on agent changes, juggling multiple sessions, agents shipping sloppy code)
- Emphasize **zero-config** and **auto-start** — the server is invisible infrastructure, not a thing you manage
- Emphasize local-first — no accounts, no cloud
- Don't oversell features that are still in progress — stick to what's shipped
- The "Why" page and blog post don't need updates right now, just the homepage
- Maintain the existing dark theme visual style

## What NOT to Change
- Don't touch the Why page or Blog page
- Don't change the visual design system (colors, fonts, layout patterns)
- **Do remove Watch Mode content** — it no longer exists as a separate concept. The watch command still works but routes through the server like everything else; it's not a user-facing "mode" anymore.
- Keep the screenshot/demo section (multi-session UI screenshot would be ideal)
- Keep the existing GitHub/npm links

## Reference: Current Feature Set for Accuracy
- Syntax-highlighted diffs (unified + split toggle)
- Inline line-level commenting (must_fix, suggestion, question, nitpick)
- File-level status tracking (unreviewed, reviewed, approved, needs_changes)
- Review briefing bar (complexity scoring, test coverage gaps, pattern flags, dependency changes, affected modules)
- Agent reasoning display panel
- Dark/light mode toggle
- Keyboard shortcuts (j/k files, n/p hunks, c comment, s status, ? hotkey guide)
- Four review decisions: approve, request changes, approve with comments, dismiss
- Quick action menu: Approve & Commit, Approve Commit & PR (executes post-review action without extra confirmation)
- Structured JSON results returned to agent (includes optional `postReviewAction` field)
- Multi-session dashboard with status badges, branch info, file counts, desktop notifications for new sessions
- Auto-start daemon — server starts automatically, no manual `diffprism server` needed
- GitHub PR review — fetch, review, and optionally post back to GitHub
- Multi-agent annotation tools: add_annotation, get_review_state, flag_for_attention
- Headless agent tools: get_diff (structured diff data) and analyze_diff (full review briefing) — enables agent self-review loop
- 9 MCP tools: open_review, update_review_context, get_review_result, get_diff, analyze_diff, add_annotation, get_review_state, flag_for_attention, review_pr
- CLI: review, watch, serve, setup, server (start/status/stop), teardown, start
- Zero-config: `npx diffprism setup` handles everything
- Global setup: `diffprism setup --global` for no-repo-required config
