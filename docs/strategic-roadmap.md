# DiffPrism Strategic Roadmap

**From Local Review Tool → AI-Powered PR Platform**

Last updated: February 2026

---

## Market Position

DiffPrism occupies a unique position in the AI code review landscape: the only tool with a **purpose-built browser review UI** that works locally AND can expand to GitHub PRs.

**Tier 1 — PR-layer tools** (CodeRabbit, Qodo, GitHub Copilot PR Reviews, Cursor Bugbot) all require a PR to exist and render inside GitHub's UI.

**Tier 2 — Pre-PR / local tools** (ZapCircle, diffray, review-now) are CLI-only with text output.

**DiffPrism bridges both tiers** with a visual, interactive, browser-based review surface that starts local and expands to PRs.

### Key Differentiators

| Capability | Tier 1 (CodeRabbit etc.) | Tier 2 (CLI tools) | DiffPrism |
|---|---|---|---|
| Pre-PR (local) review | No | Yes | Yes |
| Visual browser UI | GitHub UI only | No | Yes |
| MCP integration (Claude Code native) | No | Partial | Yes |
| Structured feedback to agent | No | No | Yes (ReviewResult JSON) |
| Inline commenting with types | No | No | Yes |
| GitHub PR review | Yes | No | Planned (Phase 2) |
| AI-powered analysis | Yes | Yes | Planned (Phase 1) |
| Interactive AI conversation | No | No | Planned (Phase 3) |

---

## Phased Roadmap

### Phase 1: AI Analysis Layer

**Goal:** Add AI-powered analysis to the existing local review experience. Differentiate from every other local review tool.

**Scope:**
- BYOK (bring your own key) Anthropic API key configuration
- Per-file AI analysis panel in the diff viewer
- Semantic analysis: security vulnerabilities, logic bugs, test coverage gaps, performance regressions, cross-file impact
- Auto-generated change summaries / PR descriptions
- Risk scoring per file (low/medium/high)
- Configurable review profiles for team-specific focus areas
- AI analysis caching per diff hash

**Architecture:** New `packages/ai` module for LLM calls. Existing `packages/analysis` stays deterministic. API calls happen server-side (WebSocket bridge), not from the browser.

**Depends on:** Existing M1/M2 features (deterministic analysis, briefing bar, inline commenting).

### Phase 2: GitHub PR Viewer Mode

**Goal:** DiffPrism becomes a standalone review app for GitHub PRs, with AI analysis.

**Scope:**
- GitHub OAuth integration (`diffprism login`)
- PR fetching (`diffprism pr owner/repo#123`)
- PR list view with filtering
- PR diff rendering in existing viewer
- AI analysis on PRs (same as Phase 1)
- Post review comments back to GitHub
- Map approve/request changes to GitHub review states
- Hosted web app mode (Cloudflare Pages or similar)

**Architecture:** New `packages/github` module (Octokit, OAuth, PR data fetching). New `GitHubSource` in core pipeline alongside existing `GitSource`.

**Revenue opportunity:** This is where DiffPrism transitions from free tool → paid product. Local review stays free. GitHub PR features + AI = paid tier.

### Phase 3: Interactive AI Review Companion

**Goal:** Real-time AI collaboration during code review, inside DiffPrism's purpose-built UI.

**Scope:**
- AI sidebar alongside the diff viewer for conversational review
- Context-aware prompting (DiffPrism controls what code context Claude sees)
- Inline question anchoring (click a line → ask AI → response anchored to that line)
- Action-oriented responses (generate tests, draft comments, analyze blast radius)
- Review session memory (conversation persists within a session)
- Multi-model support (Anthropic, OpenAI, Gemini)
- Team review templates (security review, performance review, architecture review)

**Why this wins:** CodeRabbit/Qodo post static comments with no follow-up. DiffPrism + AI companion = first tool where engineers collaborate with AI on review in real-time.

---

## Monetization Model

| Tier | Price | Features |
|---|---|---|
| **Free (forever)** | $0 | Local review, CLI + MCP, deterministic analysis |
| **Pro** | $15-20/mo per user | GitHub PR integration, AI analysis (BYOK or included credits), interactive AI companion |
| **Team** | $30-50/mo per user | Shared review templates, team analytics, org-level policies, SSO |

---

## Target Users (in order)

1. **Solo devs using Claude Code / Cursor / Codex** — generating code with agents, need a review step
2. **Tech leads on small teams (2-10 devs)** — drowning in PRs, many AI-generated
3. **Engineering orgs adopting agentic coding** — need governance and review workflows

---

## Key Metrics

- npm weekly downloads
- `npx diffprism setup` completions (MCP adoption)
- Reviews completed per user per week
- Time from review open → decision
- GitHub stars

---

## Relationship to Existing Milestones

This strategic roadmap builds on top of the existing M1-M3 milestones defined in `CLAUDE.md`:

- **M1 (Usable Review Experience)** and **M2 (Analysis + Triage)** are foundational — they must reach ~95% completion before Phase 1 AI features are meaningful.
- **M3 (Multi-Agent & Worktree Support)** runs in parallel with Phase 1 — both are infrastructure that supports the Phase 2/3 vision.
- **M4-M5 (GitHub Integration)** from the original roadmap map directly to Phase 2 here, with the addition of the hosted web app concept.
- **M6 (AI-Powered Analysis)** from the original roadmap maps to Phase 1 here, but with a more detailed scope and architecture.

---

*See individual GitHub issues for implementation details. Issues are labeled with `phase:1`, `phase:2`, or `phase:3` and include sequencing notes.*
