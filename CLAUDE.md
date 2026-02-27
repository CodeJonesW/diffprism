# DiffPrism

Local-first code review tool for agent-generated code changes. Opens a browser-based diff viewer from CLI or Claude Code (via MCP).

## Architecture

pnpm monorepo, all ESM (`"type": "module"`), TypeScript strict mode.

```
packages/core       — Shared types (types.ts), server-client utilities, global server
packages/git        — Git diff execution + unified diff parser (no deps beyond Node built-ins)
packages/analysis   — Deterministic review briefing (no deps beyond core types)
packages/ui         — React 19 + Vite 6 + Tailwind 3 + Zustand 5 + react-diff-view + refractor
packages/mcp-server — MCP tool server (9 tools), all reviews route through global server
packages/github     — GitHub PR fetching, normalization, and review submission
cli/                — Commander CLI (review, serve, setup, server commands), bin shim using tsx
```

**Dependency flow:** `git` + `analysis` → `core` (server-client + global server) → `cli` + `mcp-server`. UI is standalone Vite app connected via WebSocket. All clients use `ensureServer()` to auto-start the daemon, then route reviews through the HTTP API.

## Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/types.ts` | **The contract.** All shared interfaces. |
| `packages/core/src/server-client.ts` | `ensureServer()` auto-starts daemon + `submitReviewToServer()` HTTP client |
| `packages/core/src/global-server.ts` | `startGlobalServer()` — HTTP API + WS for multi-session reviews |
| `packages/core/src/server-file.ts` | `~/.diffprism/server.json` discovery file management |
| `packages/git/src/parser.ts` | Line-by-line state machine diff parser |
| `packages/git/src/local.ts` | `git diff` shell execution |
| `packages/analysis/src/deterministic.ts` | 6 pure analysis functions |
| `packages/ui/src/App.tsx` | React entry: loading/connected/submitted states |
| `packages/ui/src/components/DiffViewer/DiffViewer.tsx` | Unified diff with syntax highlighting |
| `packages/ui/src/store/review.ts` | Zustand store (all UI state) |
| `packages/ui/src/hooks/useWebSocket.ts` | WS connection + state dispatch |
| `packages/ui/vite.config.ts` | Vite config with inline PostCSS (Tailwind path fix) |
| `packages/mcp-server/src/index.ts` | MCP server — 9 tools, all routed through global server |
| `cli/src/commands/setup.ts` | `diffprism setup` — one-command Claude Code integration |
| `cli/src/commands/server.ts` | `diffprism server` — start/status/stop global server |
| `cli/src/templates/skill.ts` | Embedded `/review` skill content (SKILL.md template) |
| `cli/bin/diffprism.mjs` | Executable shim (tsx → src/index.ts) |

## Key Commands

```bash
pnpm install                                    # Install all deps
pnpm test                                       # Run all tests
npx tsc --noEmit -p packages/X/tsconfig.json    # Type-check one package
pnpm cli review --staged                        # CLI review (via tsx)
pnpm cli serve                                  # Start MCP server
pnpm cli setup                                  # Configure Claude Code integration
pnpm cli server                                 # Start global multi-session server
pnpm cli setup -- --global                      # Global setup (no git repo needed)
```

## Data Flow

All reviews flow through the global server (auto-started as a background daemon on first use):

1. `ensureServer()` — checks `~/.diffprism/server.json` for a running server; if not found, spawns `diffprism server --_daemon` in the background and waits for it to be ready
2. `getDiff(ref)` → `{ diffSet, rawDiff }` — git package shells out to `git diff`, parser builds DiffSet
3. `analyze(diffSet)` → `ReviewBriefing` — deterministic: file stats, triage, impact detection
4. `submitReviewToServer(serverInfo, diffRef, options)` — POSTs payload to `http://localhost:24680/api/reviews`, then polls `/api/reviews/:id/result` until the user submits
5. Global server creates session, notifies connected UI clients via WS (`session:added`)
6. UI shows session list, user selects a session, server sends `review:init`

**WebSocket protocol:**
- Server → Client: `review:init`, `diff:update`, `context:update`, `session:list`, `session:added`
- Client → Server: `review:submit`, `session:select`

## Conventions

- **All packages are ESM** (`"type": "module"`). Use `.js` extensions in relative imports.
- **Shared types** in `packages/core/src/types.ts`. Import with `import type { ... } from "@diffprism/core"`.
- **UI types duplicated** in `packages/ui/src/types.ts` — Vite can't resolve workspace deps at runtime.
- **Named exports only**, no default exports.
- **React components:** `ComponentName/ComponentName.tsx` + `index.ts` barrel. Everything else: kebab-case.
- **Silent mode:** `options.silent: true` for MCP — suppresses Vite output and console.log to prevent stdio corruption.
- **refractor v4 adapter:** `DiffViewer.tsx` wraps refractor v4's Root return to `.children` for react-diff-view compatibility.
- **Dark mode only** for M0. GitHub dark theme colors.

## File Naming

- React components: PascalCase in `ComponentName/ComponentName.tsx` with `index.ts` barrel
- Everything else: kebab-case filenames
- Exports: named exports, no default exports

## Tests

- **packages/git/src/__tests__/parser.test.ts** — 9 suites: empty input, simple modify, add/delete/rename, binary, multi-hunk, no-newline, language detection
- **packages/git/src/__tests__/fixtures/** — 5 diff fixture files
- **packages/analysis/src/__tests__/deterministic.test.ts** — 6 suites: categorize, stats, modules, tests, deps, summary, full analyze
- **packages/core/src/__tests__/global-server.test.ts** — 9 tests: HTTP API for session CRUD, result submission, context updates
- **packages/core/src/__tests__/server-file.test.ts** — 7 tests: server file read/write/remove, PID liveness checks
- **packages/core/src/__tests__/server-client.test.ts** — ensureServer() auto-start, submitReviewToServer() HTTP client
- **packages/ui/src/__tests__/store.test.ts** — 23 tests: review store, session management
- **cli/src/__tests__/setup.test.ts** — 8 suites: git root detection, .mcp.json, .claude/settings.json, skill file, summary output, global setup, isGlobalSetupDone
- **Run:** `pnpm test` or `npx vitest run` per package

## Lessons Learned (M0)

- **Tailwind content path:** When Vite runs programmatically via `createServer({ root: uiRoot })`, PostCSS configs must use absolute paths. Fixed by inlining PostCSS in `vite.config.ts` with `path.join(__dirname, "tailwind.config.js")`.
- **CSS import order:** `@import` must precede `@tailwind` directives.
- **MCP stdio safety:** Any console output during MCP mode corrupts the protocol. `silent: true` is critical.
- **Daemon auto-start:** `ensureServer()` spawns a detached background process and polls `server.json` for readiness. Logs go to `~/.diffprism/server.log`.

## UX Design Notes

**`docs/deprecated/v0/ux-design-notes.md`** is a living document tracking user experience decisions, observations, and expected behavior. **Update it whenever:**

- A default behavior changes (e.g., CLI flags, diff scope)
- A UX pain point is discovered or fixed
- A design decision is made about how the tool should feel or behave
- The user reports friction or unexpected behavior during a session

Add entries under the appropriate section with the version, rationale, and any linked issues.

## Roadmap

The roadmap is organized into three parallel tracks corresponding to three agent postures. See `product-plan.md` for the full strategic framing.

### Shipped Foundation

**Review UI (M0/M1):**
- ~~Split diff view (side-by-side) with toggle~~ ✅ v0.6.0
- ~~Inline line-level commenting~~ ✅ v0.8.0
- ~~Comment types: must_fix, suggestion, question, nitpick~~ ✅ v0.8.0
- ~~File-level status tracking~~ ✅ v0.7.0
- ~~Agent reasoning display in context panel~~ ✅ v0.5.0
- ~~Dark/light mode toggle~~ ✅ v0.9.0
- ~~Keyboard shortcuts: j/k navigate files~~ ✅ v0.2.12
- ~~`diffprism setup` — one-command Claude Code integration~~ ✅ v0.11.0
- ~~`/review` skill for Claude Code~~ ✅ v0.11.0

**Analysis (M2):**
- ~~Deterministic analysis: complexity scoring, test coverage detection, pattern flags~~ ✅ v0.4.0
- ~~Review briefing bar: summary stats, risk indicators, verification status~~ ✅ v0.3.0

**Multi-Agent (M3):**
- ~~Global server with HTTP review API~~ ✅ v0.15.0 (#88)
- ~~MCP server as HTTP client — auto-detects global server~~ ✅ v0.16.0 (#89)
- ~~Multi-session UI — session list, switching, status badges~~ ✅ v0.16.0 (#90)
- ~~Global setup — `diffprism setup --global`~~ ✅ (#91)

**Server-First Architecture:**
- ~~Auto-start daemon (`ensureServer()`) — no manual `diffprism server` needed~~ ✅ v0.33.0
- ~~Remove ephemeral/watch modes — single server code path~~ ✅ v0.34.0
- ~~Simplified skill file~~ ✅ v0.34.0

**Agent-Native Tools:**
- ~~Headless `analyze_diff(ref)` MCP tool~~ ✅ v0.30.0
- ~~Headless `get_diff(ref)` MCP tool~~ ✅ v0.30.0
- ~~`add_annotation(session_id, file, line, comment)`~~ ✅ v0.32.0
- ~~`get_review_state(session_id)`~~ ✅ v0.32.0
- ~~`flag_for_attention(session_id, files, reason)`~~ ✅ v0.32.0
- ~~`review_pr(pr)` — GitHub PR review~~ ✅ v0.34.0

### Track A: Human Review Experience

*Make the review surface the best place to understand and decide on code changes.*

**Near-term (active):**
- Keyboard shortcuts: n/p changes, c to comment (#41)
- Color readability fix (#50)
- Triage view: critical/notable/mechanical grouping + batch approve (#25)
- Run tests/lint/typecheck from UI (#44)
- Change narrative view — group files by story chapter (#43)
- Create PR from review UI (#23)
- Analysis enhancements: #51-68 (security patterns, cross-package detection, type safety flags, API surface detection, estimated review time, etc.)

**Mid-term:**
- GitHub PR integration (read): fetch PR data, render in DiffPrism with full briefing
- GitHub PR integration (write): post comments and submit reviews back to GitHub
- Interactive review: ask an agent about a specific hunk from within the review UI

**Long-term:**
- Review profiles: `.diffprism.yml` per repo with configurable workflows and analysis rules
- Review templates: different workflows for different change types

### Track B: Agent-Native Review

*Give agents direct access to review primitives so they can participate in review, not just be subjects of it.*

**Near-term:**
- Agent self-review loop — agents check own work (console.logs, test gaps, complexity) before requesting human review
- Multi-agent review composition — security/performance/convention agents annotate same diff, findings merge into single briefing
- Bidirectional review — human delegates fixes to agent from review UI, diff updates live

**Long-term:**
- Review memory — track what humans flag across reviews, surface as agent context
- Convention-aware self-review — agents check work against learned team conventions
- `should_review(ref)` — trust-based risk check, returns auto-approve/human-review recommendation

### Track C: Platform Scale

*As agent adoption grows from one developer to teams to orgs, the review surface becomes the control plane.*

**Near-term:**
- Worktree detection & metadata — identify branch, worktree path, agent context (#45)
- Review history — persist review decisions per-repo
- Per-session live watching — diff updates without new `open_review` calls

**Mid-term:**
- Convention intelligence: track reviewer patterns, codify into automated checks, convention drift detection
- Trust-graduated automation: analysis + convention history + approval patterns → risk engine
- Approval gates: domain-owner review requirements for sensitive paths
- AI-powered analysis: Claude API for intent inference, risk assessment, inline annotations

**Long-term:**
- Trust profiles per agent with graduated autonomy
- Audit trail and compliance reporting
- Org-wide visibility: review dashboards, agent effectiveness metrics, convention compliance trends
- Cross-team convention sharing

---

## Plan Alignment

DiffPrism's architecture and roadmap are documented in:
- **`docs/server-first-plan.md`** — Server-first architecture plan (Sprints 1-3 shipped, Sprint 4 deferred)
- **`docs/product-plan-discussion-2026-02-27.md`** — Strategic product vision, three agent postures, and track-based roadmap

**Before starting feature work**, check these plans to confirm the work maps to an active track.

**Flag misalignment when:**
- Work targets a feature outside the current active tracks (A/B/C near-term items)
- CLAUDE.md `## Roadmap` has drifted from the plan files (missing items, wrong status)
- A request pulls in long-term work without explicit user approval

Use **`/align`** for a deeper consistency check across plans, current work, and open issues.

---

## Developer Agent Workflow

When asked to "tackle issues" or "work on issues", follow this loop:

### 1. Discover Issues

```bash
gh issue list --state open
```

Read each open issue to understand it. Pick the best candidate:
- **Bugs before features** — fixes ship faster and help QA
- **Simple before complex** — smaller PRs merge faster
- Present your pick to the user and **wait for confirmation** before starting

### 2. Branch

```bash
git checkout main && git pull && git checkout -b fix-issue-<N>
```

Replace `<N>` with the issue number. Always branch from latest `main`.

### 3. Implement

- Make the **minimal focused change** that resolves the issue
- Follow existing conventions (ESM, named exports, kebab-case files, etc.)
- Read surrounding code before editing — understand context first

### 4. Test

```bash
pnpm test
pnpm run build
```

Both must pass. Fix any failures before proceeding.

### 5. Review with diffprism

Before committing, **always** use the diffprism MCP tool to open a review for the user. Call `mcp__diffprism__open_review` with:
- `diff_ref`: the appropriate ref (e.g. `"unstaged"`, `"staged"`, or a range like `"HEAD~3..HEAD"`)
- `title`: short description of the changes
- `description`: summary of what changed and why
- `reasoning`: your reasoning about the implementation decisions

This opens the diffprism review UI in the browser and **blocks until the user submits their review**. The tool returns the user's decision (approved, changes requested, etc.) and any comments. Fix anything they flag before proceeding.

This is critical for dogfooding — we use our own tool to review every change to this repo.

### 6. Commit

```bash
git add <specific-files>
git commit -m "description of change

Closes #<N>"
```

Reference the issue number with `Closes #N` so it auto-closes on merge.

### 7. Open PR

```bash
git push -u origin fix-issue-<N>
gh pr create --title "<prefix>: description" --body "$(cat <<'EOF'
## What changed
<summary of the change>

## Why
Closes #<N> — <brief rationale>

## Testing
- `pnpm test` passes
- `pnpm run build` passes
- <any manual testing notes>
EOF
)"
```

Before creating the PR, always:
1. **Suggest a version type** — Analyze the changes and recommend `patch:`, `minor:`, or `major:` based on:
   - `patch:` — bug fixes, documentation, refactoring, dependency updates, test additions
   - `minor:` — new features, new CLI flags, new UI components, new API endpoints
   - `major:` — breaking changes to CLI interface, ReviewResult shape, WebSocket protocol, or MCP tool schema
2. **Draft release notes** — Write a concise summary of what changed and why, suitable for the GitHub release body. Include in the PR description.
3. **Present both to the user** for confirmation before running `gh pr create`.

**PR title MUST start with a semver prefix** — this is required by CI for auto-publishing:
- `patch:` — bug fixes, small tweaks
- `minor:` — new features, non-breaking additions
- `major:` — breaking changes

The PR body becomes release notes, so write it clearly.

### Rules

- **Never push to main** — always use a feature branch + PR
- **Never bump the version** — CI handles versioning based on the PR title prefix
- **Never force push** — it rewrites history and breaks review
- **One issue per PR** — keep changes focused and reviewable
