# Landing Page Update Prompt

> Paste the prompt below into Claude when working in `~/dev/diffprism-landing`.

---

I need you to update the DiffPrism landing page to reflect the current product. Here's the full context.

## What DiffPrism Is

Local-first, browser-based code review tool for agent-generated changes. Opens a diff viewer from CLI or Claude Code (via MCP). No accounts, no cloud, everything runs locally. Current version: **v0.27.0**.

Three operational modes:
1. **Ephemeral** — One browser tab per review, auto-closes after decision. Good for one-off reviews.
2. **Watch** — Persistent browser tab, diffs auto-update every 1s as files change. Good for active development with a single agent.
3. **Global Server** — Persistent HTTP+WS server accepts reviews from multiple Claude Code sessions in one browser tab. Good for multi-agent workflows, worktrees, parallel sessions.

## Features

### Review Modes
- **Ephemeral reviews** — Agent triggers a review, browser opens, you decide, tab closes. Simple one-shot flow.
- **Watch mode** — Persistent tab that live-updates diffs as files change. Stay in flow while the agent works.
- **Global server** — `diffprism server` runs a persistent process. Multiple Claude Code sessions send reviews to one browser tab. Built for developers running agents in parallel across worktrees.

### Diff Viewer
- **Syntax-highlighted diffs** with unified and side-by-side (split) toggle
- **Inline line-level commenting** — click any gutter line to add a comment typed as must_fix, suggestion, question, or nitpick
- **Dynamic ref selector** — in global server mode, compare against any branch or commit on the fly without creating a new review
- **Review briefing bar** — complexity scoring, test coverage gaps, pattern flags, dependency changes, affected modules

### Keyboard Navigation
- `j`/`k` — navigate between files
- `n`/`p` — navigate between hunks within a file (auto-scrolls, highlights focused hunk)
- `c` — open inline comment on focused hunk
- `s` — cycle file review status
- `?` — toggle hotkey guide

### Review Workflow
- **Four decisions** — approve, request changes, approve with comments, dismiss
- **Quick actions** — Approve & Commit or Approve, Commit & PR directly from the review UI. The agent executes the action immediately — no extra confirmation step.
- **File-level status tracking** — mark each file as reviewed, approved, or needs changes
- **Agent reasoning panel** — collapsible panel showing why the agent made its changes
- **Dark/light mode toggle** with theme persistence

### Multi-Session Dashboard (Global Server)
- **Session list** with status badges, branch names, file counts, and change stats
- **Real-time updates** — session badges reflect actual review decisions (Approved / Changes Requested)
- **Auto-routing** — MCP server detects the running global server and sends reviews there automatically
- **Desktop notifications** — native OS notifications when a new review arrives while the tab is backgrounded
- **Auto-reopens browser** when a new review arrives and no UI clients are connected

### Developer Experience
- **Zero-config setup** — `npx diffprism setup` handles MCP config, hooks, and skill installation
- **Global setup** — `diffprism setup --global` configures at `~/.claude/` paths, no git repo required
- **Clean teardown** — `diffprism teardown` reverses all setup changes
- **MCP tools** — `open_review`, `update_review_context`, `get_review_result`
- **Structured results** — JSON review results returned to the agent with decision, comments, file statuses, and optional post-review action

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
- Remove "Watch Mode" from the badge — it's no longer the only headline
- Update the badge to something like "Open source · Local-first · Multi-agent"
- Keep the headline: "Code review for agent-generated changes" (still accurate)
- Update the subheading to communicate the broader value prop — review agent changes in a browser UI before they become PRs, whether that's one agent or many running in parallel

### Watch Mode Section → Modes / Multi-Agent Section
- The current Watch Mode comparison section should evolve to showcase all three modes, with the **Global Server** as the most prominent
- Consider restructuring into a "Three ways to review" or "Scales with your workflow" section that shows: Ephemeral (quick one-offs) → Watch (single agent, live) → Global Server (multi-agent dashboard)
- The multi-agent story is the differentiator: "Run three Claude Code sessions in parallel. Review them all from one tab."

### Architecture Flow
- Update or add a diagram showing the global server flow: Multiple terminals/agents → DiffPrism Server → Single browser with session list
- The current Terminal → Claude Code → Browser diagram is still valid for watch mode but doesn't tell the multi-session story

### Features Grid
- Add **Multi-session dashboard** — session list with status badges, branch info, change stats, desktop notifications
- Add **Split diff view** as a feature or mention within the existing diff viewer card
- Add **Keyboard navigation** — full keyboard-driven review with file, hunk, and comment shortcuts
- Add **Dynamic ref selector** — compare against any branch or commit without starting a new review
- Add **Quick actions** — Approve & Commit or Approve, Commit & PR in one click
- Update existing cards if needed (e.g., the Watch Mode card could mention it's one of three modes)

### How It Works
- Keep the 3-step simplicity but update step 2 to acknowledge the modes:
  - Step 1: `npx diffprism setup` (unchanged)
  - Step 2: Choose your mode — `/review` for one-shot, `diffprism watch` for live, `diffprism server` for multi-agent
  - Step 3: Decide (unchanged)

### CTA
- Update from "Ready to try Watch Mode?" to something broader — "Ready to review agent code?" or "Ready to try DiffPrism?"

## CLI Commands
```bash
npx diffprism setup           # One-command setup for Claude Code
diffprism watch --staged      # Watch mode
diffprism server              # Global multi-session server
diffprism review              # One-shot review
diffprism teardown            # Clean removal
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
