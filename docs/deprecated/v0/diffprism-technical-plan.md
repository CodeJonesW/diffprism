# DiffPrism: AI-Powered Code Review Operating System

## Technical Plan — v0.2

---

## Vision

DiffPrism is the shared review surface for agents and humans. It gives software engineers a GitHub-quality diff review experience for code changes — before they ever become a PR — and gives agents direct access to review primitives so they can participate in review, not just be subjects of it.

The tool serves three agent postures:

1. **Human validates agent code** — the agent writes code, the human reviews it in a purpose-built browser UI. This is the core product today.
2. **Agent reviews its own code** — the agent uses DiffPrism's analysis tools headlessly to check its own work (console.logs, test gaps, complexity) before requesting human review. The human gets a pre-cleaned review.
3. **Human uses agents as reviewers** — specialized agents (security, performance, conventions) analyze code and post structured findings to a review session. The human reviews the unified picture.

The UI is for humans. The tool API is for agents. Both operate on the same review sessions and the same data model.

---

## Design Philosophy

### The Reviewer is the Decision-Maker, Not the Bug-Hunter

The tool does the prep work. The human makes judgment calls. AI analysis is presented as a private briefing layer — never as comments that compete with human reviewers.

### Pre-Review, Not Post-Push

For agent-generated code, review happens locally before committing or pushing. The engineer is in review mode, not defense mode. Only after approval does code move toward a PR.

### Context Over Diffs

A diff alone is insufficient. The review surface combines code changes with intent (why the change was made), impact analysis (what it affects), verification results (tests, types, lint), and narrative (the story of the change across files).

### Respect Attention

No comment spam. Changes are triaged by risk level. Mechanical changes can be batch-approved. The engineer's focus is directed to the 2-3 decisions that actually need human judgment.

### Agents Are Tool-Users, Not Boxed Actors

Don't constrain agents to a single interaction pattern (submit code, wait for verdict). Expose composable primitives — get diff, run analysis, post annotations, read review state — so agents can participate creatively in the review process. The richer the tool surface, the more valuable the platform becomes.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  ENTRY POINTS                           │
│                                                         │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────┐  │
│  │ Standalone   │  │ Claude Code   │  │ Other MCP   │  │
│  │ CLI          │  │ (MCP Client)  │  │ Clients     │  │
│  │              │  │               │  │             │  │
│  │ diffprism    │  │ open_review() │  │             │  │
│  │ review ...   │  │               │  │             │  │
│  └──────┬───────┘  └──────┬────────┘  └──────┬──────┘  │
│         │                 │ MCP Protocol      │         │
│         └─────────────────┼───────────────────┘         │
└───────────────────────────┼─────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────┐
│                 DiffPrism Core                           │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Git Engine   │  │ Analysis     │  │ GitHub        │  │
│  │ (local diff) │  │ Engine       │  │ Integration   │  │
│  └──────┬──────┘  └──────┬───────┘  └──────┬────────┘  │
│         └────────────────┼─────────────────┘            │
│                          ▼                               │
│                  ┌──────────────┐                        │
│                  │ Review State │                        │
│                  │   Manager    │                        │
│                  └──────┬───────┘                        │
└─────────────────────────┼───────────────────────────────┘
                          │ WebSocket
                          ▼
┌─────────────────────────────────────────────────────────┐
│              DiffPrism Review UI (Browser)               │
│                   localhost:PORT                         │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Review Briefing Panel               │    │
│  │  Impact Summary · Risk Triage · Verification    │    │
│  ├─────────────────────────────────────────────────┤    │
│  │              Diff Viewer (split/unified)         │    │
│  │  Syntax Highlighting · Inline AI Annotations    │    │
│  │  Line-level Comments · File Navigator           │    │
│  ├─────────────────────────────────────────────────┤    │
│  │              Context Panel (collapsible)         │    │
│  │  Agent Reasoning · Related Code · Test Results  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  [ Approve ] [ Request Changes ] [ Approve w/ Comments ]│
└─────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. MCP Server (`@diffprism/mcp-server`)

**Runtime:** Node.js (TypeScript)
**Protocol:** MCP (Model Context Protocol) over stdio

The MCP server is the bridge between Claude Code (or any MCP client) and the review tool. It exposes tools that agents can call during a session. The same review pipeline is also accessible via the standalone CLI.

#### Exposed MCP Tools

The tool surface is organized by agent posture. Posture 1 (human validates agent) tools are shipped. Posture 2 (agent self-reviews) and Posture 3 (agent as reviewer) tools are the primary expansion target.

```typescript
// ── Posture 1: Human validates agent code (shipped) ──────────────

// Open a review for local git changes
open_review({
  diff_ref: "HEAD~3..HEAD" | "staged" | "unstaged",
  mode: "blocking" | "async",  // blocking waits for result, async returns review_id
  title?: string,
  description?: string,
  reasoning?: string,        // Agent's explanation of what it did and why
  change_narrative?: {       // Ordered story of the changes
    chapters: Array<{
      title: string,
      description: string,
      files: string[]
    }>
  }
}): ReviewResult | { review_id: string }

// Push reasoning to an existing watch/server session
update_review_context({
  title?: string,
  description?: string,
  reasoning?: string
}): void

// Poll for human decision
get_review_result({
  wait?: boolean,
  timeout?: number
}): ReviewResult | null

// Open a review for a GitHub PR (future — Track A mid-term)
open_pr_review({
  repo: "owner/repo",
  pr_number: number,
  mode: "blocking" | "async"
}): ReviewResult | { review_id: string }

// ── Posture 2: Agent self-reviews (Track B near-term) ────────────

// Get structured diff without opening UI
get_diff({
  diff_ref: "staged" | "unstaged" | "working-copy" | string
}): DiffSet

// Run analysis and get structured briefing without opening UI
analyze_diff({
  diff_ref: "staged" | "unstaged" | "working-copy" | string
}): ReviewBriefing

// Read current state of a review session
get_review_state({
  session_id: string
}): ReviewState  // files, comments, annotations, status

// Mark specific files as needing human attention
flag_for_attention({
  session_id: string,
  files: string[],
  reason: string
}): void

// Trust-based risk check (Track B long-term)
should_review({
  diff_ref: string
}): { decision: "auto_approve" | "human_review", reason: string, risk_level: number }

// ── Posture 3: Agent as reviewer (Track B mid-term) ──────────────

// Post agent findings to a review session
add_annotation({
  session_id: string,
  file: string,
  line: number,
  body: string,
  type: "finding" | "suggestion" | "question" | "warning",
  confidence?: number,       // 0-1 how confident the agent is
  category?: string          // "security" | "performance" | "convention" | etc.
}): void

// ── Return types ─────────────────────────────────────────────────

interface ReviewResult {
  decision: "approved" | "changes_requested" | "approved_with_comments" | "dismissed",
  comments: Array<{
    file: string,
    line: number,
    body: string,
    type: "must_fix" | "suggestion" | "question" | "nitpick"
  }>,
  summary?: string,
  postReviewAction?: "commit" | "commit_and_pr"
}
```

#### Behavior — Blocking Mode (Default)

When `open_review` is called with `mode: "blocking"`:
1. Server computes the diff (via git or GitHub API)
2. Runs analysis engine to generate the review briefing
3. Starts the web UI server on an available port
4. Opens the browser to `localhost:{port}/review/{id}`
5. **Blocks and waits** for the engineer's decision via WebSocket
6. Returns structured `ReviewResult` to the calling agent
7. Tears down the UI server (or keeps it alive for the session)

#### Behavior — Async Mode

When `open_review` is called with `mode: "async"`:
1. Steps 1-4 are identical
5. **Immediately returns** `{ review_id: "abc123" }` to the agent
6. The agent continues working or waits — its choice
7. Agent polls `review_status({ review_id })` when ready
8. Returns `ReviewResult` when the engineer has submitted, or `"pending"` / `"in_progress"` if still reviewing

The choice between blocking and async is made by the user in conversation with the agent (e.g., "review these changes and wait for me" vs "open a review for me, I'll check it later"). The agent passes the appropriate mode.

### 2. Git Engine (`@diffprism/git`)

**Purpose:** Extract and normalize diffs from local git state and GitHub PRs into a unified format.

```typescript
interface DiffSet {
  base_ref: string,
  head_ref: string,
  files: Array<{
    path: string,
    status: "added" | "modified" | "deleted" | "renamed",
    old_path?: string,
    hunks: Array<{
      old_start: number,
      old_lines: number,
      new_start: number,
      new_lines: number,
      changes: Array<{
        type: "add" | "delete" | "context",
        line_number: number,
        content: string
      }>
    }>,
    language: string,        // Detected via extension/shebang
    binary: boolean
  }>
}
```

**Sources:**
- Local: shell out to `git diff`, `git diff --staged`, `git diff <ref>..<ref>`, parse unified diff format
- GitHub: Use Octokit to fetch PR diff, comments, CI status, review threads

### 3. Analysis Engine (`@diffprism/analysis`)

**Purpose:** Generate the review briefing — the AI-prepared analysis that makes review faster.

This is where the tool earns its value. The analysis engine produces structured metadata that the UI renders as the briefing panel.

```typescript
interface ReviewBriefing {
  // High-level summary
  summary: string,
  
  // Risk-tiered triage
  triage: {
    critical: AnnotatedChange[],    // Needs careful human review
    notable: AnnotatedChange[],     // Worth looking at
    mechanical: AnnotatedChange[],  // Safe to batch-approve (renames, formatting, imports)
  },
  
  // Impact analysis
  impact: {
    affected_modules: string[],
    affected_tests: string[],
    public_api_changes: boolean,
    breaking_changes: string[],
    new_dependencies: string[]
  },
  
  // Verification results
  verification: {
    tests_pass: boolean | null,     // null if not run
    type_check: boolean | null,
    lint_clean: boolean | null,
    test_coverage_delta?: number
  },
  
  // Per-file annotations
  annotations: Array<{
    file: string,
    line: number,
    severity: "critical" | "warning" | "info",
    message: string,
    category: "bug_risk" | "convention" | "performance" | "security" | "readability"
  }>
}
```

#### MVP Analysis (v0.1 — No AI Required)

Start with deterministic analysis that's immediately useful:
- File change categorization (new file, modified, deleted, renamed)
- Language detection
- Line count / complexity delta
- Import/dependency change detection
- Test file identification (does this change have corresponding test changes?)
- Basic pattern matching (TODO/FIXME additions, console.log left in, etc.)

#### AI-Powered Analysis (v0.2+)

Layer in Claude API calls for deeper analysis:
- Intent inference from agent reasoning + diff context
- Convention violation detection (using codebase patterns)
- Risk assessment per change
- Suggested review focus areas
- Inline annotations with codebase-specific context

### 4. Review UI (`@diffprism/ui`)

**Runtime:** React + Vite, served from localhost
**Communication:** WebSocket to MCP server for real-time state sync

#### Layout

```
┌──────────────────────────────────────────────────────────────┐
│ DiffPrism Review: "Refactor auth middleware"       [Settings]│
├────────────┬─────────────────────────────────────────────────┤
│            │                                                 │
│  FILES     │  REVIEW BRIEFING (collapsible top bar)          │
│            │  ┌─────────────────────────────────────────┐    │
│  ● auth.ts │  │ 12 files changed · 3 need review       │    │
│  ● middleware│ │ ⚠ Breaking change in UserSession type  │    │
│  ○ utils.ts│  │ ✓ Tests pass · ✓ Types clean           │    │
│  ○ index.ts│  └─────────────────────────────────────────┘    │
│  ○ test... │                                                 │
│            │  DIFF VIEW (split or unified)                   │
│  ──────    │  ┌──────────────────┬──────────────────────┐    │
│  Legend:   │  │ - old code       │ + new code           │    │
│  ● review  │  │                  │                      │    │
│  ○ glance  │  │  [AI annotation] │                      │    │
│  ✓ approved│  │                  │ [+ Add comment]      │    │
│            │  │                  │                      │    │
│            │  └──────────────────┴──────────────────────┘    │
│            │                                                 │
│            │  CONTEXT PANEL (toggle)                         │
│            │  Agent Reasoning | Related Code | Narrative     │
├────────────┴─────────────────────────────────────────────────┤
│ [Approve All Mechanical (8)] [Request Changes] [Approve]     │
└──────────────────────────────────────────────────────────────┘
```

#### Key UI Features

**Diff Viewer**
- Split and unified view toggle
- Syntax highlighting per language (use Shiki or Prism)
- Inline comment threads (click on any line to add a comment)
- AI annotations rendered as subtle, dismissible indicators — not intrusive comment blocks
- Expand/collapse unchanged context lines
- File-level approve/reject

**Review Briefing Bar**
- Always visible summary: files changed, risk triage counts, verification status
- Expandable for full briefing detail
- Links directly to critical files/lines

**File Navigator**
- Color/icon coded by triage level (needs review, glance, mechanical)
- Per-file approval status tracking
- Change narrative mode: view files grouped by story chapter instead of alphabetically

**Context Panel**
- Agent reasoning: why the agent made these changes (passed from Claude Code)
- Change narrative: the ordered story of the changes
- Related code: other files that reference the changed code (future)

**Actions**
- Approve: structured result returned to Claude Code
- Request Changes: with line-level comments that map back to specific code
- Approve with Comments: approve but include suggestions for future
- Batch approve mechanical: one-click approval for low-risk changes

#### Tech Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Framework | React 19 + TypeScript | Ecosystem, diff libraries |
| Bundler | Vite | Fast dev, simple config |
| Diff rendering | `react-diff-view` + `diff` | Battle-tested diff components |
| Syntax highlighting | Shiki | Accurate, supports all languages, theme-able |
| Styling | Tailwind CSS | Rapid iteration, dark mode support |
| State | Zustand | Lightweight, good for WebSocket-driven state |
| WebSocket | Native WS via Vite proxy | Simple, no extra deps |
| Icons | Lucide React | Clean, consistent |

### 5. GitHub Integration Layer (`@diffprism/github`)

**Purpose:** Read from and write to GitHub so DiffPrism can serve as a superior PR review interface.

#### Read (v0.2)
- Fetch PR diff, metadata, CI status via Octokit
- Fetch existing review comments and threads
- Normalize into the same `DiffSet` + `ReviewBriefing` format as local reviews
- Display PR conversation timeline in context panel

#### Write (v0.3)
- Post review comments from DiffPrism back to GitHub
- Submit review (approve/request changes) via GitHub API
- Sync inline comments as PR review comments

#### Auth
- GitHub personal access token stored in `~/.diffprism/config.json`
- Or OAuth device flow for smoother setup

---

## Data Flow: Standalone CLI Review

```
1. Engineer runs: diffprism review HEAD~3..HEAD
2. Core pipeline:
   a. Runs git diff to get DiffSet
   b. Runs Analysis Engine to produce ReviewBriefing
   c. Starts web UI server on localhost:3847
   d. Opens browser
3. Engineer reviews in browser (same UI as MCP mode)
4. On submit, result prints to stdout as JSON and process exits
   - Useful for scripting: diffprism review --staged | jq '.decision'
   - Or just visual: the engineer sees the result and moves on
```

---

## Data Flow: Agent Review (Blocking Mode)

```
1. Engineer is in Claude Code session
2. Claude Code makes changes across 12 files
3. Claude Code calls: open_review({
     diff_ref: "unstaged",
     mode: "blocking",
     title: "Refactor auth middleware to support JWT",
     reasoning: "Extracted token validation into shared utility...",
     change_narrative: { chapters: [...] }
   })
4. MCP Server → Core Pipeline:
   a. Runs git diff to get DiffSet
   b. Runs Analysis Engine to produce ReviewBriefing
   c. Starts web UI server on localhost:3847
   d. Opens browser to localhost:3847/review/abc123
   e. Pushes DiffSet + ReviewBriefing + AgentContext to UI via WebSocket
5. Engineer reviews in browser:
   - Reads briefing summary
   - Batch-approves 8 mechanical changes
   - Reviews 3 critical files in detail
   - Leaves 2 inline comments
   - Clicks "Request Changes"
6. Core Pipeline:
   - Receives structured ReviewResult via WebSocket
   - MCP Server returns it to Claude Code over MCP
7. Claude Code receives:
   {
     decision: "changes_requested",
     comments: [
       { file: "src/auth.ts", line: 47, body: "Use the existing retry util", type: "must_fix" },
       { file: "src/types.ts", line: 12, body: "Should this be optional?", type: "question" }
     ]
   }
8. Claude Code iterates on the feedback with full context
9. Calls open_review again with updated changes
```

---

## Data Flow: Agent Review (Async Mode)

```
1. Claude Code makes changes, engineer says "open a review, I'll check it later"
2. Claude Code calls: open_review({
     diff_ref: "unstaged",
     mode: "async",
     title: "Refactor auth middleware",
     reasoning: "..."
   })
3. MCP Server immediately returns: { review_id: "abc123" }
4. Claude Code is free — can continue other work or wait
5. Browser opens, engineer reviews at their own pace
6. Later, engineer says "check my review" or Claude Code polls:
   review_status({ review_id: "abc123" })
   → { status: "pending" }  // still reviewing
   → { status: "complete", result: ReviewResult }  // done
7. Claude Code picks up the result and acts on feedback
```

---

## Data Flow: GitHub PR Review

```
1. Engineer invokes DiffPrism from CLI:
   $ diffprism review org/repo#142
   
   Or Claude Code calls: open_pr_review({ repo: "org/repo", pr_number: 142 })

2. Core Pipeline:
   a. Fetches PR data from GitHub API (diff, comments, CI, reviews)
   b. Normalizes to DiffSet
   c. Runs Analysis Engine for ReviewBriefing
   d. Opens browser UI

3. Engineer reviews with AI briefing as a PRIVATE layer
   - Existing GitHub comments visible in context
   - AI annotations visible only to the engineer
   - Engineer writes their own comments informed by the analysis

4. On submit:
   - Comments posted to GitHub as the engineer's review
   - Review status (approved/changes requested) submitted to GitHub
   - AI analysis is never posted to GitHub — it stays private
```

---

## Project Structure

```
diffprism/
├── packages/
│   ├── core/                # Shared review pipeline (used by both CLI and MCP)
│   │   ├── src/
│   │   │   ├── pipeline.ts      # Orchestrates: git diff → analysis → serve UI → collect result
│   │   │   ├── review-manager.ts # Review session state (supports blocking + async)
│   │   │   └── ws-bridge.ts     # WebSocket bridge to UI
│   │   └── package.json
│   │
│   ├── mcp-server/          # MCP tool definitions (thin wrapper around core)
│   │   ├── src/
│   │   │   ├── server.ts        # MCP server setup
│   │   │   └── tools/           # Tool handlers (open_review, review_status, etc.)
│   │   └── package.json
│   │
│   ├── git/                 # Git diff extraction + parsing
│   │   ├── src/
│   │   │   ├── local.ts         # Local git operations
│   │   │   ├── parser.ts        # Unified diff parser
│   │   │   └── types.ts         # DiffSet, Hunk, Change types
│   │   └── package.json
│   │
│   ├── analysis/            # Review briefing generation
│   │   ├── src/
│   │   │   ├── deterministic.ts # Pattern matching, categorization
│   │   │   ├── ai-reviewer.ts   # Claude API analysis (v0.2)
│   │   │   └── types.ts         # ReviewBriefing types
│   │   └── package.json
│   │
│   ├── github/              # GitHub API integration (v0.2)
│   │   ├── src/
│   │   │   ├── client.ts        # Octokit wrapper
│   │   │   ├── pr.ts            # PR data fetching
│   │   │   └── review.ts        # Post comments/reviews
│   │   └── package.json
│   │
│   └── ui/                  # React review interface
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── DiffViewer/
│       │   │   ├── FileBrowser/
│       │   │   ├── BriefingBar/
│       │   │   ├── ContextPanel/
│       │   │   ├── CommentThread/
│       │   │   └── ActionBar/
│       │   ├── hooks/
│       │   │   ├── useReviewState.ts
│       │   │   └── useWebSocket.ts
│       │   └── store/
│       │       └── review.ts    # Zustand store
│       ├── index.html
│       └── package.json
│
├── cli/                     # Standalone CLI + MCP entry point
│   ├── src/
│   │   ├── index.ts             # CLI router
│   │   ├── commands/
│   │   │   ├── review.ts        # `diffprism review` — standalone local/GH review
│   │   │   ├── serve.ts         # `diffprism serve` — start MCP server mode
│   │   │   └── config.ts        # `diffprism config` — GitHub auth, preferences
│   │   └── utils/
│   │       └── open-browser.ts
│   └── package.json
│
├── package.json             # Monorepo root (pnpm workspaces)
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Milestone Plan

### Shipped Foundation (M0–M3)

**M0: Foundation — COMPLETE**
- [x] Monorepo scaffold with pnpm workspaces
- [x] Core pipeline: diff ref → DiffSet → serve UI → collect result
- [x] Git engine: parse `git diff` output into DiffSet
- [x] Minimal React UI: file list + unified diff view with syntax highlighting
- [x] WebSocket bridge + action bar + ReviewResult return
- [x] Standalone CLI: `diffprism review` / `--staged` / `HEAD~3..HEAD`
- [x] MCP server: `open_review` tool (blocking mode)

**M1: Usable Review Experience — ~80% COMPLETE**
- [x] Split diff view (side-by-side) with toggle *(v0.6.0)*
- [x] Inline commenting with typed comments *(v0.8.0)*
- [x] File-level status tracking *(v0.7.0)*
- [x] Agent reasoning display *(v0.5.0)*
- [x] Dark/light mode *(v0.9.0)*
- [x] Keyboard shortcuts: j/k *(v0.2.12)*
- [x] `diffprism setup` + `/review` skill *(v0.11.0)*

**M2: Analysis + Triage — ~50% COMPLETE**
- [x] Deterministic analysis engine: file categorization, language detection, complexity scoring, test coverage gaps, pattern flags, dependency detection *(v0.4.0)*
- [x] Review briefing bar: summary stats, risk indicators *(v0.3.0)*

**M3: Multi-Agent — ~80% COMPLETE**
- [x] Global server with HTTP review API *(v0.15.0)*
- [x] MCP server as HTTP client — auto-detects global server *(v0.16.0)*
- [x] Multi-session UI — session list, switching, status badges *(v0.16.0)*
- [x] Global setup — `diffprism setup --global` *(v0.17.0)*

### Track A: Human Review Experience

**Goal:** Make the review surface the best place to understand and decide on code changes.

**Near-term (active):**
- [ ] Keyboard shortcuts: n/p navigate changes, c to comment (#41)
- [ ] Color readability fix (#50)
- [ ] Triage view: critical / notable / mechanical grouping + batch approve (#25)
- [ ] Run tests/lint/typecheck from UI and display results (#44)
- [ ] Change narrative view: group files by story chapter (#43)
- [ ] Create PR from review UI (#23)
- [ ] Analysis enhancements (backlog — pick as capacity allows):
  - [ ] Security-sensitive pattern detection (#57)
  - [ ] Cross-package changes detection (#54)
  - [ ] Type safety flags (#55)
  - [ ] Error handling changes detection (#56)
  - [ ] API surface changes detection (#58)
  - [ ] Config file change detection (#63)
  - [ ] Removed dependencies detection (#61)
  - [ ] Lock file impact analysis (#62)
  - [ ] Dead code indicators (#68)
  - [ ] Hardcoded values detection (#66)
  - [ ] Renamed/moved files highlighting (#65)
  - [ ] Comment change tracking (#67)
  - [ ] Commit structure analysis (#64)
  - [ ] Churn ratio stat (#51)
  - [ ] Change concentration score (#52)
  - [ ] Net lines of code stat (#53)
  - [ ] Estimated review time (#59)
  - [ ] Logic vs boilerplate ratio (#60)

**Mid-term:**
- [ ] GitHub PR integration — read: auth, fetch PR data, normalize to DiffSet, render with briefing
- [ ] GitHub PR integration — write: post comments, submit reviews, sync threads back to GitHub
- [ ] Interactive review: ask agent about a specific hunk from within the review UI

**Long-term:**
- [ ] Review profiles: `.diffprism.yml` per repo with configurable workflows
- [ ] Review templates: different workflows for different change types

### Track B: Agent-Native Review

**Goal:** Give agents direct access to review primitives so they can participate in review, not just be subjects of it.

**Near-term (highest priority new work):**

The analysis engine already exists. These tools expose it headlessly so agents can self-review.

- [ ] `get_diff(ref)` MCP tool — returns structured DiffSet without opening browser
  - Scope: `@diffprism/mcp-server` — new tool handler that calls `getDiff()` from `@diffprism/git`
  - Returns: `DiffSet` as JSON
  - Done when: agent can call `get_diff({ diff_ref: "unstaged" })` and receive structured diff data

- [ ] `analyze_diff(ref)` MCP tool — returns ReviewBriefing without opening browser
  - Scope: `@diffprism/mcp-server` — new tool handler that calls `getDiff()` + `analyze()`
  - Returns: `ReviewBriefing` as JSON (same data the briefing bar shows)
  - Done when: agent can call `analyze_diff({ diff_ref: "unstaged" })` and get back file stats, pattern flags, complexity scores, test coverage gaps

- [ ] Agent self-review workflow documentation — update `/review` skill and docs to show self-review pattern:
  ```
  Agent writes code
    → calls analyze_diff("unstaged")
    → gets: "2 console.logs, no test for new function, complexity 8/10"
    → fixes those issues
    → calls analyze_diff("unstaged") again → clean
    → calls open_review for human
  ```

**Mid-term:**

- [ ] `add_annotation(session_id, file, line, body, type)` — agent posts findings to a review session
  - Scope: `@diffprism/mcp-server` + `@diffprism/core` (global server API)
  - Annotations stored per-session, pushed to UI via WebSocket
  - UI renders agent annotations as a distinct layer (different styling from human comments)
  - Done when: an agent can post annotations that appear in the review UI alongside the diff

- [ ] `get_review_state(session_id)` — read current state of a review
  - Returns: files list, human comments, agent annotations, per-file status
  - Done when: agent can inspect what a reviewer has flagged

- [ ] `flag_for_attention(session_id, files, reason)` — mark files that need human eyes
  - UI highlights flagged files in the file browser
  - Done when: agent can direct human attention to specific files

- [ ] Multi-agent review composition
  - Multiple agents call `add_annotation` on the same session
  - Annotations grouped by source agent in the UI briefing
  - Done when: security + performance agents can both annotate and human sees unified view

- [ ] Bidirectional review — human delegates fix to agent from review UI
  - "Fix this" button on comments sends context (file, line, comment, surrounding code) back to agent
  - Agent fixes, diff updates live (extends watch mode polling)
  - Done when: human can click "fix this" and see the agent's fix appear in the same review session

**Long-term:**

- [ ] Review memory — persist what humans flag across reviews per-repo
  - Pattern extraction: "reviewer flagged X in auth.ts 3 times → convention candidate"
  - Surface as agent context when `analyze_diff` runs on related files

- [ ] Convention-aware self-review — `analyze_diff` checks against learned conventions
  - "Last 3 reviews touching auth.ts: reviewer said 'use retry utility'" → agent checks for this

- [ ] `should_review(ref)` — trust-based risk check
  - Combines: analysis risk level + convention compliance + historical approval rate
  - Returns: `{ decision: "auto_approve" | "human_review", reason, risk_level }`
  - Agents call this before `open_review` to skip low-risk reviews

### Track C: Platform Scale

**Goal:** As agent adoption grows from one developer to teams to orgs, the review surface becomes the control plane.

**Near-term:**
- [ ] Worktree detection & metadata — identify branch, worktree path, agent context (#45)
- [ ] Review history — persist review decisions per-repo (local SQLite or JSON)
- [ ] Per-session live watching — diff updates without new `open_review` calls

**Mid-term:**
- [ ] Convention intelligence: track reviewer patterns, codify into named conventions
  - Convention drift detection: surface when code diverges from team patterns
  - Pattern library: named, versioned, shareable conventions
- [ ] Trust-graduated automation: risk engine combining analysis + conventions + history
  - Configurable thresholds per change type and per agent
  - Auto-approve mechanical changes, require human review for high-risk
- [ ] Approval gates: changes to specific paths require domain-owner review
- [ ] AI-powered analysis: Claude API for deep diff analysis, intent inference, risk assessment

**Long-term:**
- [ ] Trust profiles per agent: approval rates, change-request patterns, iteration counts
- [ ] Audit trail: every review decision logged, every auto-approval traceable
- [ ] Org-wide dashboards: review activity, agent effectiveness, convention compliance
- [ ] Cross-team convention sharing: patterns discovered by one team adopted org-wide

---

## Agent Orchestration Guide

This section defines how to break the DiffPrism build into parallelizable work units for Claude Code sub-agents. The orchestrator agent reads this plan, selects the current milestone, and dispatches sub-agents using the `Task` tool.

### Principles

1. **Each sub-agent owns one package.** The monorepo is structured so packages have clean boundaries. A sub-agent working on `@diffprism/git` should not need to touch `@diffprism/ui`.
2. **Shared types are the contract.** Before dispatching sub-agents, the orchestrator should ensure `packages/core/src/types.ts` exists with the shared interfaces (`DiffSet`, `ReviewBriefing`, `ReviewResult`, etc.). Sub-agents code against these types.
3. **Integration is the orchestrator's job.** Sub-agents build and test their packages in isolation. The orchestrator wires them together and runs integration tests.
4. **Each task has clear done-criteria.** Sub-agents know exactly what "done" looks like — they can self-verify before reporting back.

### M0 Task Breakdown

The orchestrator should execute M0 in this order:

#### Phase 1: Scaffold + Shared Types (sequential, orchestrator does this)

```
Task: Initialize monorepo
- pnpm workspace setup with all package directories
- tsconfig.base.json with path aliases
- Shared types file: packages/core/src/types.ts
  Contains: DiffSet, DiffFile, Hunk, Change, ReviewResult, ReviewBriefing
- Done when: `pnpm install` succeeds, all packages resolve each other
```

#### Phase 2: Core Packages (parallel sub-agents)

```
Sub-agent 1: @diffprism/git
├── Input: DiffSet type definition from core/types.ts
├── Scope:
│   ├── local.ts — run `git diff` commands, capture stdout
│   ├── parser.ts — parse unified diff format into DiffSet
│   └── index.ts — export public API: getDiff(ref: string): DiffSet
├── Test: parse a known diff fixture into correct DiffSet structure
└── Done when: getDiff("HEAD~1..HEAD") returns valid DiffSet in a test repo

Sub-agent 2: @diffprism/ui
├── Input: DiffSet type definition from core/types.ts
├── Scope:
│   ├── Vite + React + TypeScript setup
│   ├── App.tsx — receives DiffSet via WebSocket, renders file list + diff
│   ├── components/DiffViewer — unified diff view with syntax highlighting (Shiki)
│   ├── components/FileBrowser — file list sidebar
│   ├── components/ActionBar — Approve / Request Changes buttons
│   ├── hooks/useWebSocket.ts — connect to ws://localhost:{port}, receive DiffSet
│   └── WebSocket sends ReviewResult back on action button click
├── Test: renders a hardcoded DiffSet fixture correctly
├── Constraint: container-agnostic — no window.location, no browser-tab navigation
└── Done when: UI renders a multi-file diff and action buttons emit ReviewResult via WS

Sub-agent 3: @diffprism/analysis (minimal for M0)
├── Input: DiffSet type definition from core/types.ts
├── Scope:
│   ├── deterministic.ts — file categorization, line counts, language detection
│   └── index.ts — export: analyze(diff: DiffSet): ReviewBriefing
├── Test: known DiffSet produces expected ReviewBriefing
└── Done when: analyze() returns valid ReviewBriefing with file categories and stats
```

#### Phase 3: Wiring (sequential, orchestrator or single sub-agent)

```
Task: @diffprism/core pipeline + WebSocket bridge
├── Input: all three packages from Phase 2
├── Scope:
│   ├── pipeline.ts — getDiff() → analyze() → serve UI → collect result
│   ├── ws-bridge.ts — WebSocket server, pushes DiffSet to UI, receives ReviewResult
│   ├── review-manager.ts — session state, blocking mode (resolve promise on result)
│   └── index.ts — export: startReview(options): Promise<ReviewResult>
└── Done when: startReview({ diff_ref: "HEAD~1..HEAD" }) opens browser and returns result

Task: CLI entry point
├── Input: core pipeline
├── Scope:
│   ├── cli/src/commands/review.ts — parse args, call startReview(), print result
│   └── cli/src/index.ts — command router
└── Done when: `diffprism review HEAD~1..HEAD` opens browser, returns JSON to stdout

Task: MCP server
├── Input: core pipeline
├── Scope:
│   ├── mcp-server/src/server.ts — MCP server setup over stdio
│   └── mcp-server/src/tools/open-review.ts — calls startReview(), returns to client
└── Done when: Claude Code can call open_review and receive ReviewResult
```

### M1+ Task Patterns

For subsequent milestones, follow the same pattern:

1. **Orchestrator reviews the milestone checklist** from this plan
2. **Groups tasks by package** — what changes in git? ui? analysis? core?
3. **Dispatches sub-agents per package** with:
   - The relevant section of this plan as context
   - The current state of the package's types/interfaces
   - Clear done-criteria from the milestone checklist
4. **Orchestrator integrates and tests** after sub-agents complete

### Context Passing to Sub-Agents

When dispatching a sub-agent, the orchestrator should provide:

```
1. This plan's relevant sections (architecture, component spec, types)
2. The specific task scope and done-criteria
3. The shared types file (packages/core/src/types.ts)
4. Any existing code in the target package (if iterating)
5. Do NOT pass the entire plan — only what's relevant to the task
```

### Dependency Graph (M0)

```
shared types (core/types.ts)
    ├── @diffprism/git         ─┐
    ├── @diffprism/ui           ├── parallel
    └── @diffprism/analysis    ─┘
                │
        @diffprism/core (pipeline + ws-bridge)
                │
        ┌───────┴───────┐
        │               │
    cli/review      mcp-server
```

---

## Future Vision

### The Agent Self-Review Loop
The near-term unlock. Agents use `analyze_diff` to check their own work before requesting human review. The human's review queue arrives pre-filtered: mechanical catches already handled, human attention directed to judgment calls. This single capability transforms the review experience without any UI changes.

### Review as Collaboration, Not Gatekeeping
With composable tools, review becomes a conversation between agents and humans on the same surface. Agents post findings, humans validate and override, the system learns. The review session is the shared artifact — not a gate the agent passes through, but a workspace where both parties contribute.

### Convention Intelligence as Agent Context
Past human review decisions become agent instructions automatically. DiffPrism tracks what reviewers flag, extracts patterns, and feeds them back as context when agents self-review. The agent learns the team's preferences through DiffPrism's memory, not through prompt engineering. Each review makes the next one better.

### Trust as a Gradient, Not a Binary
Trust calibration means different change types get different review depths. Mechanical refactors by trusted agents auto-approve. New business logic gets full human review. Security-sensitive paths require domain-owner sign-off. The human sets the thresholds; the system enforces them. Agents can ask `should_review` before opening a review — the system knows when human judgment is needed.

### Interactive Simulation
For UI changes, embed a live preview. For API changes, show example request/response diffs. For data model changes, show migration impact. The review surface becomes not just a diff viewer but a verification environment.

---

## Resolved Decisions

1. **Naming:** DiffPrism. Package scope `@diffprism/*`, CLI command `diffprism`, npm package `diffprism`.

2. **Blocking vs async:** User-determined per invocation via `mode` parameter. Blocking is default. Async returns a `review_id` for polling. The engineer communicates their preference to the agent conversationally.

3. **Standalone mode:** Yes. `diffprism review` works without any agent or MCP connection. The core review pipeline is shared between CLI and MCP entry points. Standalone mode prints results to stdout; MCP mode returns them over the protocol.

4. **UI surface:** Browser-first. `diffprism review` opens a localhost tab — zero packaging overhead, fast dev loop, no OS-specific issues. The eventual desktop wrapper path is Tauri (Rust-based, ~3MB binary vs Electron's ~150MB), but only when a real limitation is hit. UI is container-agnostic: no `window.location` hacks, single-page app that can be dropped into any shell.

5. **Three agent postures:** The roadmap is organized around three modes of agent-human interaction: human validates agent (Posture 1, shipped), agent self-reviews (Posture 2, Track B near-term), human uses agent as reviewer (Posture 3, Track B mid-term). The tool surface expands to serve all three.

6. **UI for humans, API for agents:** The browser review UI serves human review. The MCP tool surface serves agent participation. Both operate on the same sessions and data model. Agents should never need to go through the browser to access analysis or review state.

7. **Track-based roadmap:** Three parallel tracks (A: Human Review, B: Agent-Native Review, C: Platform Scale) replace the linear M4-M8 milestone sequence. Tracks develop in parallel and reinforce each other.

---

## Open Questions

1. **Pre-built UI vs dev server:** Should the UI be a pre-built static bundle (faster startup, no node_modules at runtime) or run via Vite dev server (hot reload during development, slower cold start)? Likely answer: pre-built for distribution, Vite for development — but need to wire up the build pipeline.

2. **AI analysis cost:** The Claude API calls for deep analysis have a cost per review. Should this be opt-in per review, or always-on with a local model fallback?

3. **Config file location:** `~/.diffprism/config.json` for global config (GitHub auth, preferences). Should there also be per-repo `.diffprism.json` for team conventions? (Becomes more relevant with Track C convention intelligence.)

4. **Distribution:** npm global install (`npm i -g diffprism`)? Homebrew? Binary via `pkg` or `bun build --compile`? Start with npm, consider binary later for zero-dependency installs.

5. **Headless tool output format:** When agents call `analyze_diff` or `get_diff`, what's the right level of detail? The full `ReviewBriefing` and `DiffSet` types are comprehensive but verbose. Should headless tools return condensed summaries by default with a `verbose` flag for full data? Or always return the full structure and trust the agent to extract what it needs?

6. **Agent annotation persistence:** When an agent posts annotations via `add_annotation`, should those persist across sessions? If a security agent flags a pattern in `auth.ts`, should that annotation reappear next time `auth.ts` is reviewed? This ties into review memory (Track B long-term) but affects the data model now.

7. **Self-review loop integration:** Should the self-review loop be built into the `/review` skill (agent automatically runs `analyze_diff` before `open_review`) or left as a pattern agents discover via documentation? Built-in means consistent behavior; pattern-based means agents can adapt the loop to context.

8. **Analysis engine informed by agent conversation:** The agent has rich context the analysis engine doesn't see — conversation history, requirements, rejected approaches. Right now `open_review` only passes `reasoning` (a string), which is lossy compression. Options:
   - **Minimal (current):** Agent writes a summary into `reasoning`. Simple but the agent decides what's relevant.
   - **Structured context:** Expand payload with requirements, constraints, rejected alternatives. More useful for analysis but requires good agent extraction.
   - **Hybrid:** Agent passes structured context + analysis engine can optionally pull more context for ambiguous cases.

   With headless tools, this becomes more tractable: the agent can call `analyze_diff` with additional context parameters and get back analysis that's aware of intent. The context panel could show "user requirement → code change that satisfies it," making review a verification exercise.

9. **Multi-agent annotation conflict resolution:** When multiple agents annotate the same line, how should the UI present conflicting findings? Stack them? Merge? Let the human dismiss individual sources? This design decision affects both the data model and the UI.


Deprecated on Feb 27, 2026