# DiffPrism Product Plan

---

## The Market Right Now (Feb 2026)

The AI code review space has exploded but it's stratified into two clear tiers:

**PR-layer tools** (CodeRabbit, Qodo/PR-Agent, Copilot PR Reviews, Bito) — these all hook into GitHub/GitLab webhooks and comment on PRs after they're opened. They're mature, well-funded, and competing on context depth (cross-repo awareness, system-level reasoning). CodeRabbit is the market leader for PR automation. Qodo is the enterprise play.

**Pre-PR / local tools** (ZapCircle, diffray, review-now Claude Code plugin) — this is the newer, scrappier category. These run git diff locally, pipe it to an LLM, and give you feedback before you push. They're CLI-first, mostly single-developer tools.

**DiffPrism's gap** — and your opportunity — is that nobody owns the visual, local-first review experience for agent-generated code. Every tool in category 2 is CLI-only. Every tool in category 1 requires a PR to exist. You're building for the moment between — when Claude Code or Cursor just wrote 400 lines across 8 files and you need to actually understand and approve those changes before they become a PR. That's a UI problem, not a CLI problem.

---

## Phase 1: Own the Local Agent Review UX — COMPLETE

Your core value prop is clear: *"GitHub-quality diff review for agent-generated code, before it's a PR."* The key differentiators to double down on:

- [x] **Visual diff viewer** — split/unified view, syntax highlighting, file tree navigation. This is table stakes but it's what separates you from CLI tools.
- [x] **Session-based review** — group changes by agent session/task, not just by git diff. When Claude Code runs a task, it touches N files. DiffPrism should understand that as a single reviewable unit.
- [x] **Annotation layer** — let the engineer mark files as "reviewed," "needs changes," "skip." This is what makes it a review OS not just a diff viewer.
- [x] **Local-first, zero config** — `npx diffprism` in any git repo, opens in browser. No GitHub app install, no API keys for the basic experience.
- [x] **`diffprism setup`** — one-command Claude Code integration (MCP config, permissions, `/review` skill)

---

## Phase 2: Multi-Agent & Worktree Support — NOT STARTED

The core vision: developers using git worktrees to run multiple agents in parallel, with DiffPrism as the unified review layer. This is the immediate next unlock — as agent-driven development scales, engineers will have 2-5 agents working concurrently, each producing changes that need review.

- [ ] **Review session persistence** — save to disk, survive restarts
- [ ] **Async review mode** — `open_review({ mode: "async" })` returns review_id, poll with `review_status()`
- [ ] **Worktree detection & metadata** — identify branch, worktree path, agent context
- [ ] **Multi-review dashboard** — single view of all active reviews across worktrees
- [ ] **Review queuing** — don't flood the developer with N browser tabs

---

## Phase 3: GitHub PR Integration — The Big Unlock

This is where your iframe/frame wrapper idea gets really interesting. Here's how I'd think about it architecturally:

**The concept:** DiffPrism as a web app that can pull GitHub PRs via the API, render them in your own diff viewer with your own AI analysis layer on top — essentially a better PR review experience than GitHub's native one.

**The review workbench vision** — a browser-based environment where:

- [ ] **PR access** — the engineer opens a PR in DiffPrism (either via URL or OAuth-connected repo list)
- [ ] **Native rendering** — DiffPrism renders the diff with its own viewer
- [ ] **Embedded AI** — a Claude instance (via API, not literally iframe-ing claude.ai) can analyze the PR in context
- [ ] **Conversational review** — the engineer can have a conversation with Claude about the PR — *"why did this change the auth middleware?" / "is this migration safe?" / "write me a test for this edge case"*
- [ ] **Anchored responses** — Claude's responses are anchored to specific lines/files in the diff, not floating in a chat window

This is not an iframe wrapping Claude. It's DiffPrism as the **orchestration layer** that:

- [ ] Fetches PR data via GitHub API
- [ ] Renders it in your diff UI
- [ ] Pipes relevant context (diff hunks, file contents, repo structure) to Claude via the Anthropic API
- [ ] Renders Claude's analysis inline in the diff view
- [ ] Lets the engineer respond/iterate, with the conversation context maintained

> Think of it less as "Claude in an iframe" and more as *"DiffPrism is the IDE for code review, Claude is the copilot inside it."*

---

## Phase 4: AI-Powered Analysis

Once the review surface is established across local, worktree, and GitHub contexts, layer in AI-powered analysis:

- [ ] **Inline AI annotations** — security issues, logic bugs, style violations surfaced as comments alongside the diff (like CodeRabbit does on PRs, but locally and before push)
- [ ] **Change summary generation** — auto-generate the PR description you'll use when you do push
- [ ] **Risk scoring** — flag high-risk files (auth, payment, data models) so engineers know where to focus human attention
- [ ] **Configurable review profiles** — `.diffprism.yml` with team-specific rules, similar to how diffray does agent configs
- [ ] **Intent inference** — from agent reasoning + code context
- [ ] **Convention detection** — from codebase patterns

---

## Why This Wins

The strategic moat here is the **review surface**. Every other AI code review tool is either:

- A GitHub bot that posts comments (you're reading reviews in GitHub's UI, which is mediocre)
- A CLI that dumps text (you're reading reviews in your terminal)
- An IDE extension (you're reading reviews in VS Code, which isn't built for review)

DiffPrism would be the **purpose-built review environment** — the place engineers go specifically to review code, whether it's local agent output or remote PRs. That's a new category.

### The Progression

- [x] **Local diff viewer** (npm package, opens in browser) → developer tool, bottom-up adoption
- [ ] **Multi-agent review hub** (worktree support, async mode, dashboard) → power-user tool for agent-heavy workflows
- [ ] **PR review app + AI analysis + collaborative conversation** → team product, SaaS revenue
- [ ] **Review OS** with org-level policies, review templates, approval workflows → enterprise product
