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

As agent adoption moves from individual developers to teams and organizations, the review surface becomes the natural place to enforce consistency and maintain quality at scale. Each capability below emerges from a real problem that surfaces when multiple people and multiple agents are producing code into the same codebase.

#### Convention Intelligence

The tool tracks what reviewers consistently flag and codifies those patterns into automated checks. If three engineers on the same team each flag "don't use raw SQL in this codebase" in the same month, that becomes a named convention — versioned, shareable, and enforced on future reviews.

- **Convention learning:** Review decisions train the system. Patterns the team flags repeatedly become automated checks that surface in future briefings.
- **Pattern library:** Named, versioned conventions shareable across projects and teams. A team's conventions are a first-class artifact, not tribal knowledge.
- **Convention drift detection:** Surfaces when code diverges from established team patterns — not just style, but architectural patterns, error handling approaches, and API design conventions.
- **Beyond linters:** Codebase-specific enforcement that goes deeper than what static analysis catches. "We always wrap external API calls in a retry utility." "Data model changes require a migration file." "New endpoints need rate limiting." These are the conventions that live in people's heads today.

#### Review Orchestration

Different kinds of changes need different review workflows. A formatting fix and a payment system change shouldn't go through the same process.

- **Review profiles:** Configurable `.diffprism.yml` per repo or team. Define which analysis rules run, what approval requirements apply, and how changes are triaged.
- **Review templates:** Security-sensitive changes route differently than documentation updates. Teams define the templates; the tool applies them based on which files and patterns are touched.
- **Approval gates:** Changes to specific paths — auth, payments, data models, infrastructure — require review from designated domain owners before they can proceed.
- **Escalation rules:** High-risk changes auto-route to senior engineers. The risk assessment from the analysis engine drives the routing, so human attention goes where it matters most.

#### Trust Calibration

Not all agents and not all change types carry the same risk. The review system should reflect that.

- **Trust profiles per agent:** Track approval rates, change-request patterns, and iteration counts over time. An agent that consistently produces clean refactors earns different treatment than one that's new to the codebase.
- **Graduated autonomy:** Mechanical refactors by trusted agents can be batch-approved with a single click. New business logic, API surface changes, and security-sensitive code always get full human review. The threshold is configurable, not hardcoded.
- **Threshold tuning:** Teams define their own risk tolerance per change category and per agent. A startup iterating fast and a regulated fintech have different needs — the same tool should serve both.
- **Audit trail:** Every review decision is logged. Every auto-approval is traceable. As agent usage scales, the ability to answer "who approved this and why" becomes essential — not just for compliance, but for debugging process failures.

#### Multi-Agent Review Composition

When teams run specialized analysis — security scanning, performance profiling, convention checking — those results should converge into a single briefing, not scatter across separate tools.

- **Specialized analysis agents:** Security-focused, performance-focused, convention-focused agents all feed into the same unified briefing surface. The reviewer sees one coherent picture, not three separate reports.
- **Configurable composition:** Teams choose which analysis agents run for which repos and paths. A frontend repo might run accessibility and bundle-size checks; a backend API repo might run security and rate-limit analysis.
- **Custom analysis rules:** Team-specific patterns that go beyond generic code quality. Not "this function is too long," but "this service doesn't follow our circuit breaker pattern."

#### Organization Visibility

When agent-assisted development scales across an engineering org, leadership needs to understand what's happening — not to micromanage, but to identify where the process is working and where it's breaking down.

- **Review activity dashboards:** What's being reviewed, what's bottlenecked, where agents are producing changes that consistently need iteration.
- **Agent effectiveness metrics:** Which agents produce approvable code on the first pass. Which consistently need changes. Where the iteration loop is longest. This data informs both tool configuration and team practices.
- **Convention compliance trends:** Track how well code aligns with team patterns over time. Spot drift early — before it becomes tech debt.
- **Cross-team pattern sharing:** When one team discovers a useful convention, the org can adopt it. Review patterns become institutional knowledge that compounds.

---

## The Agent Scale Problem

The features above aren't speculative. They're the predictable consequence of agent adoption moving from individual use to team-wide practice.

**One developer, one agent** — local review is enough. `diffprism review --staged` solves the problem completely. You know the codebase, you know what you asked for, you review the output and move on.

**One developer, multiple agents running in parallel** — the global server and multi-session UI handle this. You're still the single reviewer, but now you're switching between sessions, comparing approaches, approving or rejecting work from several agents at once. Still a single-person workflow, but the tooling needs to keep up with the throughput.

**A team of developers, each working with agents** — this is where things change. Agent A writes retry logic one way. Agent B uses a different pattern in the same codebase. Three engineers independently flag the same convention violation in the same week. Without shared conventions, review templates, and team-wide visibility, the codebase fragments. Each developer-agent pair optimizes locally while the overall system drifts. Shared conventions and review orchestration aren't nice-to-haves at this stage — they're how you prevent the codebase from becoming incoherent.

**An org with dozens of teams and hundreds of agent sessions per day** — policy enforcement, trust calibration, audit trails, and approval workflows become the difference between "agents help us ship faster" and "agents created a mess we can't maintain." The review surface — which is already where every change gets human attention — is the natural control plane. It sees every change, knows the conventions, tracks the decisions, and directs attention to the places that matter. Everything else in the stack either produces code or consumes it. The review layer is where the human judgment happens.

---

## Why This Wins

The strategic moat is the **review surface**. Every other AI code review tool renders its output in someone else's UI — GitHub's comment thread, your terminal, a VS Code sidebar. DiffPrism owns the environment where review happens. That's a fundamentally different position.

GitHub bots post comments into GitHub's mediocre diff viewer. CLI tools dump text into your terminal. IDE extensions wedge review into an editor that wasn't built for it. DiffPrism is the place engineers go specifically to review code — purpose-built for that single activity, optimized for agent-generated changes, designed to amplify the human reviewer rather than replace them.

The progression:

1. **Local diff viewer** — npm package, opens in browser, zero-config. Developer tool, bottom-up adoption. Engineers adopt it because it's the fastest way to review agent output. *(shipped)*
2. **Multi-agent review hub** — global server, async mode, multi-session dashboard. Power-user tool for agent-heavy workflows. Becomes essential infrastructure as teams scale agent usage. *(shipped — global server, MCP routing, session UI, global setup)*
3. **PR review workbench + AI analysis** — GitHub integration brings existing PR workflows into DiffPrism's review surface. AI analysis runs privately — the engineer sees security flags, convention checks, and risk assessments alongside the diff, but only their human-authored comments post to GitHub. Teams adopt this because it makes review faster and catches things GitHub's native UI doesn't surface.
4. **Review OS** — the review surface becomes the control plane for agent-assisted development at scale. Convention intelligence learns what the team values and enforces it automatically. Trust calibration gives agents graduated autonomy — mechanical work flows through, judgment calls get human attention. Org-wide visibility shows which agents are effective, where conventions are drifting, and what needs a senior engineer's eye. Every layer below this one feeds data into the system: reviews teach conventions, conventions inform triage, triage directs attention. The longer a team uses it, the more it knows.

Each layer builds on the one below it. The review surface is the foundation. Convention intelligence is the flywheel. Everything else is leverage.

---

*Feature tracking, milestones, and implementation details live in `diffprism-technical-plan.md`.*
