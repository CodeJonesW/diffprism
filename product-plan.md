# DiffPrism — Product Vision

## The Problem

The AI code review space has stratified into two tiers, and neither is built for how engineers actually work with agents.

**PR-layer tools** — CodeRabbit, Qodo, Copilot PR Reviews, Bito — hook into GitHub webhooks and comment on pull requests after they're opened. They're mature, well-funded, and competing on context depth. But they arrive too late. By the time a PR exists, the code is already committed, pushed, and psychologically "done." Review becomes defense, not discovery.

**Pre-PR CLI tools** — ZapCircle, diffray, various Claude Code plugins — run `git diff` locally, pipe it to an LLM, and dump feedback to the terminal. They're fast and frictionless, but they treat code review as a text problem. Reading a 400-line diff in a terminal is not reviewing it. There's no visual structure, no annotation layer, no way to track what you've looked at and what you haven't.

**The moment nobody owns** is the one between agent output and pull request. Claude Code just rewrote your auth middleware across 8 files. Cursor just generated a new API endpoint with tests. You need to actually understand and approve those changes before they become a PR. That's a UI problem, not a CLI problem. It requires a purpose-built review surface — and nothing on the market provides one.

But there's a deeper gap that neither tier addresses. Agents are tool-users. They want to analyze code, check their own work, post findings, and participate in review — not just be subjects of it. And engineers want to direct agents as reviewers — point them at a diff, get structured analysis back, layer that into their own review process. Today's tools treat review as a one-directional gate: code goes in, decision comes out. The future is a collaborative surface where agents and humans both contribute to the review conversation.

---

## The Thesis

DiffPrism is the shared review surface for agents and humans.

Local-first. Visual. Zero-config. It opens a browser-based diff viewer — GitHub-quality syntax highlighting, split and unified views, inline commenting, file-level status tracking — directly from your working directory. No GitHub app install. No API keys. No PR required.

The insight is that code review for agent output is a fundamentally different activity than traditional PR review. The reviewer didn't write the code. They may not have even specified the approach. They need to build understanding from scratch, in real time, across a set of changes they didn't author. That demands a dedicated environment: one that combines the diff with the agent's reasoning, surfaces what matters, lets you annotate and approve file by file, and returns structured feedback to the agent so it can iterate.

But the deeper insight is that agents shouldn't be boxed into the role of "code producer awaiting human judgment." Agents are tool-users. The richer the tool surface DiffPrism exposes, the more creative and capable agents become at participating in review — checking their own work, analyzing code for other agents, surfacing findings for human attention. The review surface is the shared language. The tool surface is how agents speak it.

DiffPrism is the IDE for code review. The diff viewer is the foundation for human review. The tool API is the foundation for agent participation. Everything else — analysis, triage, conventions, trust — layers on top of both.

---

## Three Agent Postures

DiffPrism serves three distinct modes of interaction between agents and humans. Each demands different capabilities from the tool, and each unlocks different value.

### Posture 1: Human validates agent code

*The agent writes code. The human reviews it.*

This is what DiffPrism does today. Agent calls `open_review`, browser opens with a diff, human approves or requests changes, structured result flows back to the agent. The tool's value is the review surface itself — visual diff, briefing, annotations, structured feedback.

**What this needs:** A great review UI. Split/unified views, inline commenting, file status tracking, keyboard navigation, agent reasoning display. Shipped.

### Posture 2: Agent reviews its own code

*The agent writes code, then uses DiffPrism to check its own work before asking the human.*

This is the highest-value near-term unlock. The agent runs DiffPrism's analysis on its own changes — did I leave console.logs? Did I break the public API? Did I add tests? — and iterates before ever opening a review for the human. The human gets a pre-cleaned review. Their attention goes to judgment calls, not mechanical catches.

**What this needs:** Headless analysis tools. The agent needs to call `analyze_diff` and get back a structured ReviewBriefing without opening a browser. The analysis engine already exists — agents just need direct access to the primitives.

### Posture 3: Human uses agents as reviewers

*The human directs agents to analyze code and surfaces their findings in the review.*

A security-focused agent scans for vulnerabilities. A performance agent flags N+1 queries. A convention agent checks team patterns. Their findings merge into a single briefing. The human reviews the unified picture — agent analysis as a private layer that informs their judgment without replacing it.

This also works interactively: human is reviewing a diff, sees a complex function, asks an agent "what does this do?" — the agent responds with analysis anchored to the specific lines.

**What this needs:** A way for agents to consume review sessions (read the diff, read existing annotations) and post structured findings back (inline comments with confidence, citations, suggested fixes). A composition layer that merges findings from multiple agents into one briefing.

---

## Where We Are

DiffPrism ships today as an npm package and Claude Code MCP integration. Run `npx diffprism review --staged` in any git repo and a browser tab opens with a full diff viewer. Or use `diffprism setup` to integrate with Claude Code in one command — the agent calls `open_review()`, the browser opens, you review, and your structured decision flows back to the agent automatically.

The core review experience is solid. Split and unified diff views with syntax highlighting. Inline line-level commenting with typed comments (must-fix, suggestion, question, nitpick). File-level status tracking so you know what you've reviewed and what you haven't. An agent reasoning panel that shows why the changes were made. Dark and light mode. Keyboard navigation.

The analysis engine runs deterministic checks on every review: file categorization, complexity scoring, test coverage gap detection, dependency change detection, pattern flags (leftover console.logs, TODOs, disabled tests). These surface in a briefing bar at the top of every review — a quick orientation before you dive into the diff.

The multi-agent foundation is live. `diffprism server` starts a persistent HTTP+WS server that accepts reviews from multiple Claude Code sessions simultaneously. The MCP server auto-detects the global server and routes reviews there. The multi-session UI shows all active reviews with status badges, branch info, and change stats in one tab.

The tool dogfoods itself. Every change to this repo goes through DiffPrism review before it becomes a PR.

---

## Where We're Going

The roadmap is organized around three tracks that correspond to the three agent postures. They develop in parallel — each track has near-term and long-term work, and they reinforce each other.

### Track A: Human Review Experience

*Make the review surface the best place to understand and decide on code changes.*

This is the foundation. If the human review experience isn't excellent, nothing else matters. The review surface is where human judgment happens — it needs to be fast, clear, and purposeful.

**Near-term (active):**
- Triage view: critical/notable/mechanical grouping with batch approve for mechanical changes
- Run tests/lint/typecheck from the review UI and surface results in the briefing
- Keyboard shortcuts: n/p to navigate changes, c to comment
- Change narrative view: group files by story chapter instead of alphabetically
- Create PR directly from the review UI
- Analysis enhancements: security patterns, cross-package detection, type safety flags, API surface detection, estimated review time

**Mid-term:**
- GitHub PR integration (read): review PRs in DiffPrism with the full briefing experience
- GitHub PR integration (write): post comments and submit reviews back to GitHub
- Interactive review: ask an agent about a specific hunk from within the review UI — "explain this," "is this safe?" — and get analysis anchored to the exact lines

**Long-term:**
- Review profiles: `.diffprism.yml` per repo with configurable workflows, analysis rules, and approval requirements
- Review templates: different workflows for different change types (security-sensitive, data model, API surface)

### Track B: Agent-Native Review

*Give agents direct access to review primitives so they can participate in review, not just be subjects of it.*

This is the strategic differentiation. Every other code review tool treats agents as code producers. DiffPrism treats them as participants in the review conversation. The richer the tool surface, the more creative and capable agents become.

**Near-term (highest priority new work):**
- **Headless analysis API**: expose `analyze_diff(ref)` as an MCP tool that returns a structured ReviewBriefing without opening a browser. The analysis engine already exists — this is wiring, not building.
- **Agent self-review loop**: with headless analysis available, agents can check their own work before requesting human review. Did I leave console.logs? Did I add tests? Is complexity reasonable? The agent iterates until the analysis is clean, then opens the human review. The human gets a pre-cleaned diff.
- **Composable tool primitives**: break the monolith `open_review` into building blocks agents can use independently:
  - `get_diff(ref)` → returns raw DiffSet as structured data
  - `analyze_diff(ref)` → returns ReviewBriefing without opening UI
  - `add_annotation(session_id, file, line, comment)` → agent posts findings to a review session
  - `get_review_state(session_id)` → read current state of a review
  - `flag_for_attention(session_id, files, reason)` → mark files that need human eyes

**Mid-term:**
- **Agent review annotations**: agents can consume a review session (read the diff, existing annotations) and post structured findings back — inline comments with confidence scores, convention citations, suggested fixes. When the human opens the review, agent analysis is already layered in.
- **Multi-agent review composition**: security agent, performance agent, convention agent all analyze the same diff. Their findings merge into a single briefing. The human sees one coherent picture.
- **Bidirectional review**: from the review UI, a human can delegate a fix to an agent — "fix this" on a specific line sends the context to the agent, which fixes it, and the diff updates live in the review. The review → feedback → fix → re-review loop collapses into a single session.

**Long-term:**
- **Review memory**: DiffPrism tracks what humans flag across reviews. When an agent opens a new review, the analysis engine checks past patterns — "last 3 times auth.ts was changed, the reviewer said 'use the retry utility.'" Past human review decisions become agent context automatically.
- **Convention-aware self-review**: agents check their work against the team's learned conventions before human review. The self-review loop gets smarter over time.

### Track C: Platform Scale

*As agent adoption grows from one developer to teams to orgs, the review surface becomes the control plane.*

**Near-term:**
- Worktree detection and metadata: identify branch, worktree path, agent context in session metadata
- Review history: persist review decisions per-repo for future convention learning
- Per-session live watching: diff updates without new `open_review` calls

**Mid-term:**
- **Convention intelligence**: track what reviewers consistently flag. Patterns that appear repeatedly become named conventions — versioned, shareable, enforced on future reviews. Not linters — codebase-specific rules like "wrap external API calls in a retry utility" or "data model changes require a migration file."
- **Trust-graduated automation**: combine analysis + convention history + approval patterns into a risk engine. Mechanical refactors by trusted agents → auto-approve with notification. New business logic → full human review. The human sets the thresholds, DiffPrism enforces them. Agents can call `should_review(ref)` to check before opening a review.
- **Approval gates**: changes to specific paths (auth, payments, data models) require review from designated domain owners

**Long-term:**
- Trust profiles per agent: track approval rates, change-request patterns, iteration counts over time
- Audit trail: every review decision logged, every auto-approval traceable
- Org-wide visibility: review activity dashboards, agent effectiveness metrics, convention compliance trends
- Cross-team convention sharing: patterns discovered by one team can be adopted org-wide

---

## The Composable Tool Surface

The current MCP tools (`open_review`, `update_review_context`, `get_review_result`) are UI-centric — they assume the goal is always "open a browser for a human." The expanded tool surface gives agents access to the building blocks:

| Tool | Purpose | Posture |
|------|---------|---------|
| `open_review` | Open browser, block for human decision | 1 (existing) |
| `update_review_context` | Push reasoning to an existing session | 1 (existing) |
| `get_review_result` | Poll for human decision | 1 (existing) |
| `get_diff` | Get structured DiffSet without UI | 2 (new) |
| `analyze_diff` | Get ReviewBriefing without UI | 2 (new) |
| `add_annotation` | Post agent findings to a session | 3 (new) |
| `get_review_state` | Read current state of a review | 2, 3 (new) |
| `flag_for_attention` | Mark files for human review | 2 (new) |
| `should_review` | Check risk level, get auto-approve/human-review recommendation | 2 (future) |

The principle: the UI is for humans, the API is for agents, both operate on the same review sessions and the same data model.

---

## The Agent Scale Problem

The three postures play out differently at different scales.

**One developer, one agent** — Posture 1 (human validates) is sufficient. `diffprism review --staged` solves the problem. But even here, Posture 2 (agent self-review) makes the experience better — the agent catches mechanical issues before the human sees them.

**One developer, multiple agents in parallel** — the global server and multi-session UI handle the human review side. But with composable tools, agents can self-review independently before requesting human attention. The developer's review queue arrives pre-filtered: mechanical catches already handled, human attention directed to the decisions that actually need judgment.

**A team of developers, each working with agents** — this is where Posture 3 and convention intelligence become essential. Agent A writes retry logic one way, Agent B uses a different pattern. Without conventions, the codebase fragments. With convention-aware self-review, agents check their work against team patterns before the human even sees it. Convention intelligence isn't a team management feature — it's how agents learn what the team values.

**An org with hundreds of agent sessions per day** — trust calibration, audit trails, and approval workflows become the difference between "agents help us ship faster" and "agents created a mess we can't maintain." The review surface is the natural control plane — it sees every change, knows the conventions, tracks the decisions, and directs attention where it matters. But at this scale, agents aren't just producing code — they're reviewing it, checking conventions, running analysis, and making preliminary trust assessments. The tool surface is as important as the review surface.

---

## Why This Wins

The strategic moat is the **review surface** combined with the **tool surface**.

Every other AI code review tool renders its output in someone else's UI — GitHub's comment thread, your terminal, a VS Code sidebar. DiffPrism owns the environment where review happens. That's a fundamentally different position.

But owning the review surface alone isn't enough. The compounding advantage comes from being the platform that agents use to think about code. When agents use DiffPrism's analysis to self-review, the human gets better reviews. When agents post findings to review sessions, the human sees a richer briefing. When DiffPrism tracks what humans flag, agents learn the team's conventions. Each loop reinforces the others.

The progression:

1. **Local diff viewer** — npm package, opens in browser, zero-config. Developer tool, bottom-up adoption. Engineers adopt it because it's the fastest way to review agent output. *(shipped)*
2. **Multi-agent review hub** — global server, multi-session dashboard. Power-user tool for agent-heavy workflows. *(shipped)*
3. **Agent-native analysis platform** — headless tools let agents self-review and post findings. The review surface becomes a collaboration layer between agents and humans. Review quality improves because agents do the prep work. *(next)*
4. **PR review workbench + AI analysis** — GitHub integration brings existing PR workflows into DiffPrism's review surface. AI analysis runs privately. *(mid-term)*
5. **Review OS** — convention intelligence learns what the team values. Trust calibration gives agents graduated autonomy. The review surface becomes the control plane for agent-assisted development at scale. The longer a team uses it, the more it knows. *(long-term)*

Each layer builds on the one below it. The review surface is the human foundation. The tool surface is the agent foundation. Convention intelligence is the flywheel. Everything else is leverage.

---

*Feature tracking, milestones, and implementation details live in `diffprism-technical-plan.md`.*
