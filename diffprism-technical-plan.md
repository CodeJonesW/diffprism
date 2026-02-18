# DiffPrism: AI-Powered Code Review Operating System

## Technical Plan — v0.1

---

## Vision

DiffPrism is a local-first code review tool that gives software engineers a GitHub-quality diff review experience for agent-generated code changes — before they ever become a PR. It works as a standalone CLI tool for any git changes, integrates with Claude Code via MCP for agent-assisted workflows, surfaces AI-prepared review briefings, and provides a rich decision surface that amplifies the human reviewer rather than replacing them.

The tool bridges local development and GitHub, serving as both a pre-push review environment for agent work and a superior interface for reviewing team PRs.

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

```typescript
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

// Open a review for a GitHub PR
open_pr_review({
  repo: "owner/repo",
  pr_number: number,
  mode: "blocking" | "async"
}): ReviewResult | { review_id: string }

// Check status of an active review (used with async mode)
review_status({
  review_id: string
}): ReviewStatus   // "pending" | "in_progress" | ReviewResult

// Return type — structured feedback back to the agent
interface ReviewResult {
  decision: "approved" | "changes_requested" | "approved_with_comments",
  comments: Array<{
    file: string,
    line: number,
    body: string,
    type: "must_fix" | "suggestion" | "question" | "nitpick"
  }>,
  summary?: string           // Free-form feedback from the engineer
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

### M0: Foundation (Week 1-2)

**Goal:** Open a browser-based diff viewer from both CLI and Claude Code via MCP.

- [ ] Monorepo scaffold with pnpm workspaces
- [ ] Core pipeline: accepts a diff ref, produces DiffSet, serves UI, collects result
- [ ] Git engine: parse `git diff` output into DiffSet
- [ ] Minimal React UI: file list + unified diff view with syntax highlighting
- [ ] WebSocket bridge: server pushes DiffSet to UI
- [ ] Action bar: Approve / Request Changes buttons
- [ ] WebSocket return: UI sends ReviewResult back to server
- [ ] Standalone CLI: `diffprism review` / `diffprism review --staged` / `diffprism review HEAD~3..HEAD`
- [ ] MCP server: thin wrapper that calls core pipeline, exposes `open_review` tool (blocking mode)
- [ ] MCP serve command: `diffprism serve` starts the MCP server for Claude Code

**Demo:** Two paths work:
- `diffprism review --staged` → browser opens with diff → engineer clicks Approve → result prints to stdout
- Claude Code calls `open_review` → browser opens → engineer clicks Approve → Claude Code receives structured result

### M1: Usable Review Experience (Week 3-4)

**Goal:** An experience that's genuinely better than reading diffs in the terminal.

- [ ] Split diff view (side-by-side) with toggle
- [ ] Inline commenting: click any line to add a comment
- [ ] Comment types: must_fix, suggestion, question, nitpick
- [ ] File-level status tracking (reviewed, approved, needs changes)
- [ ] Agent reasoning display in context panel
- [ ] Change narrative view: group files by story chapter
- [ ] Async mode: `open_review({ mode: "async" })` returns review_id, `review_status()` polls
- [ ] Dark mode (default) with light mode toggle
- [ ] Keyboard shortcuts: j/k navigate files, n/p navigate changes, c to comment

### M2: Analysis + Triage (Week 5-6)

**Goal:** The tool starts doing prep work for the reviewer.

- [ ] Deterministic analysis engine:
  - File categorization (new, modified, deleted, renamed)
  - Change complexity scoring (lines changed, cyclomatic delta)
  - Test coverage detection (does changed code have test changes?)
  - Pattern flags (console.log, TODO, hardcoded values)
  - Import/dependency change detection
- [ ] Review briefing bar: summary stats, risk indicators, verification status
- [ ] Triage view: critical / notable / mechanical grouping
- [ ] Batch approve mechanical changes
- [ ] Run tests/lint/typecheck from UI and display results

### M3: GitHub Integration — Read (Week 7-8)

**Goal:** Review GitHub PRs in DiffPrism with the full briefing experience.

- [ ] GitHub auth setup (PAT config via `diffprism config github-auth`)
- [ ] Fetch PR data: diff, metadata, comments, CI status, review threads
- [ ] Normalize PR data into DiffSet + existing conversation context
- [ ] Display PR info in UI: CI badges, existing reviews, comment threads
- [ ] CLI: `diffprism review owner/repo#123`
- [ ] MCP: `open_pr_review({ repo: "owner/repo", pr_number: 123 })`

### M4: GitHub Integration — Write (Week 9-10)

**Goal:** DiffPrism becomes your PR review workflow.

- [ ] Post inline comments to GitHub from DiffPrism
- [ ] Submit review (approve / request changes) to GitHub
- [ ] Sync comment threads: replies in DiffPrism appear on GitHub
- [ ] Private AI annotations: never posted to GitHub, only visible locally

### M5: AI-Powered Analysis (Week 11-12)

**Goal:** The briefing gets smart.

- [ ] Claude API integration for deep diff analysis
- [ ] Intent inference from agent reasoning + code context
- [ ] Convention detection from codebase patterns
- [ ] Risk assessment with explanations
- [ ] Inline AI annotations with codebase-specific suggestions
- [ ] Learning from review patterns: track what the engineer consistently flags

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

## Future Vision (Post-MVP)

### Codebase Convention Learning
The tool tracks review patterns over time. When you consistently flag a certain pattern (e.g., "we don't use raw SQL"), it becomes a convention that future analyses check automatically.

### Trust Calibration
Over time, build a trust profile for agent-generated changes. Mechanical refactors by Claude Code get auto-approved. New business logic gets full review. The thresholds adjust based on the agent's track record.

### Multi-Agent Review Composition
Multiple AI agents can contribute to the review briefing — a security-focused agent, a performance-focused agent, a style-focused agent — all feeding into the same unified briefing surface.

### Team Conventions Sync
Export learned conventions as a shareable config so the whole team benefits from review patterns.

### Interactive Simulation
For UI changes, embed a live preview. For API changes, show example request/response diffs. For data model changes, show migration impact.

---

## Resolved Decisions

1. **Naming:** DiffPrism. Package scope `@diffprism/*`, CLI command `diffprism`, npm package `diffprism`.

2. **Blocking vs async:** User-determined per invocation via `mode` parameter. Blocking is default. Async returns a `review_id` for polling. The engineer communicates their preference to the agent conversationally.

3. **Standalone mode:** Yes. `diffprism review` works without any agent or MCP connection. The core review pipeline is shared between CLI and MCP entry points. Standalone mode prints results to stdout; MCP mode returns them over the protocol.

4. **UI surface:** Browser-first. `diffprism review` opens a localhost tab — zero packaging overhead, fast dev loop, no OS-specific issues. The eventual desktop wrapper path is Tauri (Rust-based, ~3MB binary vs Electron's ~150MB), but only when a real limitation is hit (global shortcuts, native window management, file system watchers). The UI must be designed container-agnostic from day one: no `window.location` hacks, no reliance on browser-specific navigation, single-page app that can be dropped into any shell. This makes a future Tauri wrap a weekend project, not a refactor.

---

## Open Questions

1. **Pre-built UI vs dev server:** Should the UI be a pre-built static bundle (faster startup, no node_modules at runtime) or run via Vite dev server (hot reload during development, slower cold start)? Likely answer: pre-built for distribution, Vite for development — but need to wire up the build pipeline.

2. **AI analysis cost:** The Claude API calls for deep analysis have a cost per review. Should this be opt-in per review, or always-on with a local model fallback?

3. **Config file location:** `~/.diffprism/config.json` for global config (GitHub auth, preferences). Should there also be per-repo `.diffprism.json` for team conventions?

4. **Distribution:** npm global install (`npm i -g diffprism`)? Homebrew? Binary via `pkg` or `bun build --compile`? Start with npm, consider binary later for zero-dependency installs.

5. **Analysis engine informed by agent conversation:** The agent (Claude Code) has rich context that the analysis engine currently doesn't see — the full conversation history, requirements discussed, tradeoffs weighed, rejected approaches, and the user's intent. Right now `open_review` only passes `reasoning` (a string) and `change_narrative` (structured chapters), which is a lossy compression of that context.

   The question is how much of the conversation should flow into the analysis, and in what form:
   
   - **Minimal (current):** Agent writes a summary into `reasoning`. Simple, but the agent decides what's relevant and the analysis engine can't ask follow-up questions or cross-reference the conversation against the code.
   - **Structured context object:** Expand the `open_review` payload to accept richer metadata — requirements, constraints, rejected alternatives, known tradeoffs, related tickets/issues. The agent extracts and structures this from the conversation before calling the tool. More useful for analysis but requires the agent to do good extraction.
   - **Full conversation transcript:** Pass the entire conversation (or a window of it) to the analysis engine. The engine can then correlate "user said they want retry logic" with "this file adds retry logic" and verify intent alignment. Most powerful for analysis, but raises context window cost, privacy considerations (conversation may contain unrelated content), and latency.
   - **Hybrid:** The agent passes structured context + the analysis engine can optionally request the full transcript for deeper analysis. This keeps the default fast and cheap while allowing the engine to "pull" more context when it encounters something ambiguous.
   
   This also affects the UI — if the analysis engine understands the conversation, the context panel could show not just "agent reasoning" but a mapping of "user requirement → code change that satisfies it," making review a verification exercise rather than a comprehension exercise.
   
   Related sub-questions: Should the conversation context be stored with the review session so it's available for future reference? Should the analysis engine be able to flag when code changes don't appear to match the discussed requirements (intent drift detection)?
