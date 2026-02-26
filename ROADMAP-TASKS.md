# DiffPrism Roadmap Task Tracker

> This document tracks implementation progress toward the new vision. Update checkboxes as work is completed. Each session should read this file to understand what's done and what's next.

**Last updated:** 2026-02-26
**Current version:** v0.30.0
**Branch for plan docs:** `new-maps`

---

## Status Legend

- [ ] Not started
- [x] Complete
- 🔄 In progress

---

## Phase 1: Headless Agent Tools (Track B — Immediate Priority)

*The analysis engine exists. These tasks expose it headlessly so agents can self-review. This is wiring, not building.*

- [x] **1.1 `get_diff` MCP tool** *(shipped v0.29.0, PR #128)*
  - Add tool handler in `packages/mcp-server/src/index.ts`
  - Accepts `diff_ref` parameter (same values as `open_review`: "staged", "unstaged", "working-copy", or ref range)
  - Calls `getDiff()` from `@diffprism/git`, returns `DiffSet` as JSON
  - No browser, no WebSocket — pure data return
  - Files: `packages/mcp-server/src/index.ts`
  - Verify: agent can call `get_diff({ diff_ref: "unstaged" })` and receive structured DiffSet

- [x] **1.2 `analyze_diff` MCP tool** *(shipped v0.29.0, PR #128)*
  - Add tool handler in `packages/mcp-server/src/index.ts`
  - Accepts `diff_ref` parameter
  - Calls `getDiff()` → `analyze()`, returns `ReviewBriefing` as JSON
  - Same analysis the briefing bar shows, but headless for agent consumption
  - Files: `packages/mcp-server/src/index.ts`
  - Verify: agent can call `analyze_diff({ diff_ref: "unstaged" })` and receive ReviewBriefing with complexity scores, test gaps, pattern flags

- [x] **1.3 Update `/review` skill + docs for self-review pattern** *(shipped v0.29.0, PR #128)*
  - Update `cli/src/templates/skill.ts` to document the self-review loop:
    ```
    Agent writes code
      → analyze_diff("unstaged") → gets issues
      → fixes issues
      → analyze_diff("unstaged") → clean
      → open_review for human
    ```
  - Update `docs/workflows.md` with Posture 2 workflow section
  - Files: `cli/src/templates/skill.ts`, `docs/workflows.md`

- [x] **1.4 Update `diffprism setup` to auto-approve new tools** *(shipped v0.29.0, PR #128)*
  - Add `get_diff` and `analyze_diff` to the auto-approve tool list
  - Files: `cli/src/commands/setup.ts`
  - Verify: `diffprism setup` includes new tools in `.claude/settings.json`

**Phase 1 done when:** An agent can self-review its own code headlessly before opening a human review. `pnpm test` and `pnpm run build` pass.

---

## Phase 2: Smarter Triage (Track A — Enables better reviews)

*The triage system currently puts everything in "notable." Real categorization makes both human review and agent self-review more useful.*

- [x] **2.1 Implement real file categorization** *(shipped v0.30.0, PR #129)*
  - Update `categorizeFiles()` in `packages/analysis/src/deterministic.ts`
  - Critical: files with security patterns, breaking API changes, high complexity (score >= 8)
  - Mechanical: pure renames, formatting-only changes, import-only changes, config-only
  - Notable: everything else
  - Files: `packages/analysis/src/deterministic.ts`
  - Add tests for categorization logic
  - Verify: `analyze()` returns non-empty critical/mechanical arrays for appropriate diffs

- [ ] **2.2 Triage view in UI**
  - Group files by critical/notable/mechanical in the file browser
  - Visual indicators (color/icon) per triage level
  - "Batch approve mechanical" button in action bar
  - Files: `packages/ui/src/components/FileBrowser/`, `packages/ui/src/components/ActionBar/`
  - Depends on: 2.1

**Phase 2 done when:** Files are meaningfully categorized and the UI groups them by risk level with batch approve for mechanical changes.

---

## Phase 3: Annotation Infrastructure (Track B — Posture 3 foundation)

*Unlocks "agent as reviewer" — specialized agents can post structured findings to review sessions.*

- [x] **3.1 Add annotation types to core** *(shipped v0.30.0, PR #129)*
  - New interfaces in `packages/core/src/types.ts`:
    - `Annotation`: file, line, body, type (finding/suggestion/question/warning), confidence (0-1), category (security/performance/convention/etc), sourceAgent
    - `SessionState`: files, comments, annotations, per-file status
  - Mirror types in `packages/ui/src/types.ts`

- [x] **3.2 Add annotation API to global server** *(shipped v0.30.0, PR #129)*
  - `POST /api/reviews/:id/annotations` — agent posts findings
  - `GET /api/reviews/:id/state` — returns full session state
  - WebSocket: `annotation:added` event pushes to connected UI clients
  - Files: `packages/core/src/global-server.ts`
  - Add tests in `packages/core/src/__tests__/global-server.test.ts`

- [ ] **3.3 `add_annotation` MCP tool**
  - New tool handler in `packages/mcp-server/src/index.ts`
  - POSTs to global server annotation API
  - Parameters: session_id, file, line, body, type, confidence?, category?
  - Files: `packages/mcp-server/src/index.ts`

- [ ] **3.4 `get_review_state` MCP tool**
  - New tool handler in `packages/mcp-server/src/index.ts`
  - GETs session state from global server
  - Returns: files, comments, annotations, status
  - Files: `packages/mcp-server/src/index.ts`

- [ ] **3.5 Render agent annotations in UI**
  - Distinct visual layer from human comments (different styling/color, dismissible)
  - Annotations grouped by source agent in briefing panel
  - Files: `packages/ui/src/components/DiffViewer/`, `packages/ui/src/store/review.ts`, `packages/ui/src/types.ts`

**Phase 3 done when:** An agent can post annotations to a review session and they appear in the UI alongside the diff. A second agent can annotate the same session. Human sees unified view.

---

## Phase 4: Verification & Narrative (Track A — Review depth)

- [ ] **4.1 Run tests/lint/typecheck from UI**
  - Backend: new WS command or API endpoint to execute verification commands in the repo
  - Results populate `verification` fields in `ReviewBriefing` (currently all `null`)
  - UI: verification badges become interactive — click to run, show pass/fail
  - Security: commands must be sandboxed to the repo directory
  - Files: `packages/core/`, `packages/ui/`

- [ ] **4.2 Change narrative view**
  - Accept `change_narrative` chapters in `open_review` payload
  - UI: toggle between alphabetical and chapter-based file grouping in file browser
  - Files: `packages/ui/src/components/FileBrowser/`, `packages/core/src/types.ts`

**Phase 4 done when:** User can run tests from the review UI and see results. Files can be grouped by narrative chapter.

---

## Phase 5: Platform Foundations (Track C)

- [x] **5.1 Worktree detection & metadata (#45)** *(shipped v0.30.0, PR #129)*
  - Detect if running in a git worktree, extract branch/path info
  - Surface in session metadata for multi-agent context
  - Files: `packages/git/src/local.ts`, `packages/core/src/types.ts`

- [x] **5.2 Review history persistence** *(shipped v0.30.0, PR #129)*
  - Store review decisions per-repo (local JSON in `.diffprism/history/`)
  - Record: timestamp, decision, files reviewed, comments made, ref
  - Foundation for convention learning later
  - Files: new module in `packages/core/`

- [ ] **5.3 `flag_for_attention` MCP tool**
  - Agent marks specific files for human attention with a reason
  - UI highlights flagged files in file browser with the reason
  - Depends on: Phase 3 annotation infrastructure
  - Files: `packages/mcp-server/src/index.ts`, `packages/core/src/global-server.ts`, `packages/ui/`

**Phase 5 done when:** Worktree info shows in session metadata. Review decisions are persisted locally. Agents can flag files for human attention.

---

## Phase 6: GitHub Integration (Track A — Mid-term)

- [ ] **6.1 GitHub PR read integration**
  - Implement `@diffprism/github` package (currently empty placeholder)
  - Auth: GitHub PAT stored in `~/.diffprism/config.json` or OAuth device flow
  - Fetch PR diff, metadata, CI status, review threads via Octokit
  - Normalize to `DiffSet` + `ReviewBriefing` (same format as local reviews)
  - New CLI command: `diffprism review owner/repo#123`
  - Files: `packages/github/src/`

- [ ] **6.2 GitHub PR write integration**
  - Post comments from DiffPrism back to GitHub as PR review comments
  - Submit review (approve/request changes) via GitHub API
  - Sync inline comments as PR review threads
  - AI analysis stays private — never posted to GitHub
  - Depends on: 6.1
  - Files: `packages/github/src/`

**Phase 6 done when:** User can review a GitHub PR in DiffPrism with the full briefing experience, and post their review back to GitHub.

---

## Open Design Questions

These need answers before or during implementation. Record decisions here as they're made.

1. **Headless tool output verbosity** — Should `analyze_diff` return the full `ReviewBriefing` or a condensed summary? → _Decision: Full ReviewBriefing JSON (shipped v0.29.0)_
2. **Self-review loop integration** — Built into `/review` skill automatically, or pattern agents discover via docs? → _Decision: Documented in skill template + workflows.md (shipped v0.29.0)_
3. **Annotation persistence** — Do agent annotations persist across sessions or are they per-review? → _Decision: TBD_
4. **Multi-agent annotation conflicts** — When two agents annotate the same line, stack or merge? → _Decision: TBD_
5. **Verification command sandboxing** — How to safely run tests/lint in the repo from the review UI? → _Decision: TBD_

---

## Session Log

Record what was accomplished each session to maintain context.

| Date | Session | What was done |
|------|---------|---------------|
| 2026-02-26 | Planning | Analyzed product plan, technical plan, and CLAUDE.md. Created this task tracker. Identified Phase 1 (headless tools) as immediate priority. |
| 2026-02-26 | Phase 1 | Shipped headless `get_diff` + `analyze_diff` MCP tools, updated setup/teardown, skill docs, workflows. PR #128 → v0.29.0. |
| 2026-02-26 | Phase 2-5 parallel | 5 worktree agents: real file triage (2.1), annotation types (3.1), annotation API (3.2), worktree detection (5.1), review history (5.2). Merged + fixed CI. PR #129 → v0.30.0. |
| 2026-02-26 | Phase 3-5 parallel | Launching 5 agents: add_annotation MCP (3.3), get_review_state MCP (3.4), triage UI (2.2), annotation rendering (3.5), flag_for_attention (5.3). |
