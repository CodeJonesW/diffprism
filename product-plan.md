# DiffPrism — Product Vision

## The Problem

The AI code review space has stratified into two tiers, and neither is built for how engineers actually work with agents.

**PR-layer tools** — CodeRabbit, Qodo, Copilot PR Reviews, Bito — hook into GitHub webhooks and comment on pull requests after they're opened. They're mature, well-funded, and competing on context depth. But they arrive too late. By the time a PR exists, the code is already committed, pushed, and psychologically "done." Review becomes defense, not discovery.

**Pre-PR CLI tools** — ZapCircle, diffray, various Claude Code plugins — run `git diff` locally, pipe it to an LLM, and dump feedback to the terminal. They're fast and frictionless, but they treat code review as a text problem. Reading a 400-line diff in a terminal is not reviewing it. There's no visual structure, no annotation layer, no way to track what you've looked at and what you haven't.

**The moment nobody owns** is the one between agent output and pull request. Claude Code just rewrote your auth middleware across 8 files. Cursor just generated a new API endpoint with tests. You need to actually understand and approve those changes before they become a PR. That's a UI problem, not a CLI problem. It requires a purpose-built review surface — and nothing on the market provides one.

---

## The Thesis

DiffPrism is the purpose-built review surface for agent-generated code.

Local-first. Visual. Zero-config. It opens a browser-based diff viewer — GitHub-quality syntax highlighting, split and unified views, inline commenting, file-level status tracking — directly from your working directory. No GitHub app install. No API keys. No PR required.

The insight is that code review for agent output is a fundamentally different activity than traditional PR review. The reviewer didn't write the code. They may not have even specified the approach. They need to build understanding from scratch, in real time, across a set of changes they didn't author. That demands a dedicated environment: one that combines the diff with the agent's reasoning, surfaces what matters, lets you annotate and approve file by file, and returns structured feedback to the agent so it can iterate.

DiffPrism is the IDE for code review. The diff viewer is the foundation. Everything else — analysis, triage, multi-agent support, GitHub integration, AI-powered annotations — layers on top of that surface.

---

## Where We Are

DiffPrism ships today as an npm package and Claude Code MCP integration. Run `npx diffprism review --staged` in any git repo and a browser tab opens with a full diff viewer. Or use `diffprism setup` to integrate with Claude Code in one command — the agent calls `open_review()`, the browser opens, you review, and your structured decision flows back to the agent automatically.

The core review experience is solid. Split and unified diff views with syntax highlighting. Inline line-level commenting with typed comments (must-fix, suggestion, question, nitpick). File-level status tracking so you know what you've reviewed and what you haven't. An agent reasoning panel that shows why the changes were made. Dark and light mode. Keyboard navigation.

The analysis engine runs deterministic checks on every review: file categorization, complexity scoring, test coverage gap detection, dependency change detection, pattern flags (leftover console.logs, TODOs, disabled tests). These surface in a briefing bar at the top of every review — a quick orientation before you dive into the diff.

The tool dogfoods itself. Every change to this repo goes through DiffPrism review before it becomes a PR.

---

## Where We're Going

### Multi-Agent Review

**Shipped.** The global server architecture is live. `diffprism server` starts a persistent HTTP+WS server that accepts reviews from multiple Claude Code sessions simultaneously. The MCP server auto-detects the global server and routes reviews there — no browser tab per review. The multi-session UI shows all active reviews with status badges, branch info, and change stats in one tab. Global setup (`diffprism setup --global`) configures skill and permissions without requiring a git repo.

**Remaining:** Worktree detection (identify branch/worktree/agent context in review metadata) and per-session live watching (diff updates without new `open_review` calls).

### AI-Powered Analysis

The analysis engine today is deterministic — pattern matching, heuristics, file categorization. The next layer uses the Claude API for deep analysis: intent inference from agent reasoning and code context, convention detection from codebase patterns, risk assessment with explanations, and inline annotations that surface security issues, logic bugs, and style violations alongside the diff. Think CodeRabbit's analysis quality, but local and before push.

### GitHub PR Integration

DiffPrism as a review workbench for pull requests. Fetch PR data via the GitHub API, render it in DiffPrism's diff viewer with the full briefing experience, and layer in conversational review — ask Claude about the PR, get responses anchored to specific lines in the diff. Post your review back to GitHub when you're done. AI analysis stays private; only your human review comments hit the PR.

### Team and Enterprise Workflows

The progression from developer tool to team product. Configurable review profiles (`.diffprism.yml`) with team-specific rules. Convention learning that tracks what you consistently flag and turns patterns into automated checks. Org-level policies, review templates, approval workflows. Shareable convention configs so the whole team benefits from review patterns.

---

## Why This Wins

The strategic moat is the **review surface**. Every other AI code review tool renders its output in someone else's UI — GitHub's comment thread, your terminal, a VS Code sidebar. DiffPrism owns the environment where review happens. That's a fundamentally different position.

GitHub bots post comments into GitHub's mediocre diff viewer. CLI tools dump text into your terminal. IDE extensions wedge review into an editor that wasn't built for it. DiffPrism is the place engineers go specifically to review code — purpose-built for that single activity, optimized for agent-generated changes, designed to amplify the human reviewer rather than replace them.

The progression:

1. **Local diff viewer** — npm package, opens in browser, zero-config. Developer tool, bottom-up adoption. Engineers adopt it because it's the fastest way to review agent output. *(shipped)*
2. **Multi-agent review hub** — global server, async mode, multi-session dashboard. Power-user tool for agent-heavy workflows. Becomes essential infrastructure as teams scale agent usage. *(shipped — global server, MCP routing, session UI, global setup)*
3. **PR review workbench + AI analysis** — GitHub integration, conversational review with Claude, deep analysis layer. Team product with SaaS potential.
4. **Review OS** — org-level policies, convention learning, approval workflows, trust calibration. Enterprise product.

Each layer builds on the one below it. The review surface is the foundation. Everything else is leverage.

---

*Feature tracking, milestones, and implementation details live in `diffprism-technical-plan.md`.*
