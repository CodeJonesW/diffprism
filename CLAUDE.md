# DiffPrism

Local-first code review tool for agent-generated code changes. Opens a browser-based diff viewer from CLI or Claude Code (via MCP).

## Architecture

pnpm monorepo, all ESM (`"type": "module"`), TypeScript strict mode.

```
packages/core       — Shared types (types.ts), pipeline orchestrator, WebSocket bridge
packages/git        — Git diff execution + unified diff parser (no deps beyond Node built-ins)
packages/analysis   — Deterministic review briefing (no deps beyond core types)
packages/ui         — React 19 + Vite 6 + Tailwind 3 + Zustand 5 + react-diff-view + refractor
packages/mcp-server — MCP tool server (open_review), @modelcontextprotocol/sdk + zod
packages/github     — Placeholder (M3+)
cli/                — Commander CLI (review, serve commands), bin shim using tsx
```

**Dependency flow:** `git` + `analysis` → `core` (pipeline) → `cli` + `mcp-server`. UI is standalone Vite app connected via WebSocket.

## Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/types.ts` | **The contract.** All shared interfaces. |
| `packages/core/src/pipeline.ts` | `startReview()` orchestrator |
| `packages/core/src/ws-bridge.ts` | WebSocket server with reconnect handling |
| `packages/git/src/parser.ts` | Line-by-line state machine diff parser |
| `packages/git/src/local.ts` | `git diff` shell execution |
| `packages/analysis/src/deterministic.ts` | 6 pure analysis functions |
| `packages/ui/src/App.tsx` | React entry: loading/connected/submitted states |
| `packages/ui/src/components/DiffViewer/DiffViewer.tsx` | Unified diff with syntax highlighting |
| `packages/ui/src/store/review.ts` | Zustand store (all UI state) |
| `packages/ui/src/hooks/useWebSocket.ts` | WS connection + state dispatch |
| `packages/ui/vite.config.ts` | Vite config with inline PostCSS (Tailwind path fix) |
| `packages/mcp-server/src/index.ts` | MCP server + open_review tool |
| `cli/bin/diffprism.mjs` | Executable shim (tsx → src/index.ts) |

## Key Commands

```bash
pnpm install                                    # Install all deps
pnpm test                                       # Run all tests
npx tsc --noEmit -p packages/X/tsconfig.json    # Type-check one package
pnpm cli review --staged                        # CLI review (via tsx)
pnpm cli serve                                  # Start MCP server
```

## Data Flow

1. `getDiff(ref)` → `{ diffSet, rawDiff }` — git package shells out to `git diff`, parser builds DiffSet
2. `analyze(diffSet)` → `ReviewBriefing` — deterministic: file stats, triage (all notable for M0), impact detection
3. `startReview(options)` orchestrates: get ports → start WS bridge → start Vite dev server → open browser → send `review:init` → await `review:submit` → cleanup → return ReviewResult

**WebSocket protocol:**
- Server → Client: `{ type: "review:init", payload: { reviewId, diffSet, rawDiff, briefing, metadata } }`
- Client → Server: `{ type: "review:submit", payload: ReviewResult }`
- WS bridge stores pending init for late-connecting clients, 2s reconnect grace for React HMR

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
- **Run:** `pnpm test` or `npx vitest run` per package

## Lessons Learned (M0)

- **Tailwind content path:** When Vite runs programmatically via `createServer({ root: uiRoot })`, PostCSS configs must use absolute paths. Fixed by inlining PostCSS in `vite.config.ts` with `path.join(__dirname, "tailwind.config.js")`.
- **CSS import order:** `@import` must precede `@tailwind` directives.
- **WS bridge reconnect:** React dev mode double-mounts components, causing WS disconnect/reconnect. Added 2-second grace timer before rejecting.
- **Pipeline UI path:** `resolveUiRoot()` walks up from `import.meta.url` to workspace root — fragile if files move.
- **MCP stdio safety:** Any console output during MCP mode corrupts the protocol. `silent: true` is critical.

## UX Design Notes

**`docs/ux-design-notes.md`** is a living document tracking user experience decisions, observations, and expected behavior. **Update it whenever:**

- A default behavior changes (e.g., CLI flags, diff scope)
- A UX pain point is discovered or fixed
- A design decision is made about how the tool should feel or behave
- The user reports friction or unexpected behavior during a session

Add entries under the appropriate section with the version, rationale, and any linked issues.

## Roadmap

### M1: Usable Review Experience
- Split diff view (side-by-side) with toggle
- Inline line-level commenting (click any line to add comment)
- Comment types: must_fix, suggestion, question, nitpick
- File-level status tracking (reviewed/approved/needs changes)
- Agent reasoning display in context panel
- Change narrative view (group files by story chapter)
- Async mode: `open_review({ mode: "async" })` returns review_id, poll with `review_status()`
- Dark/light mode toggle
- Keyboard shortcuts: j/k navigate files, n/p changes, c to comment

### M2: Analysis + Triage
- Enhanced deterministic analysis: complexity scoring, test coverage detection, pattern flags
- Review briefing bar: summary stats, risk indicators, verification status
- Triage view: critical/notable/mechanical grouping
- Batch approve mechanical changes
- Run tests/lint/typecheck from UI

### M3: GitHub Integration — Read
- GitHub auth (PAT config)
- Fetch PR data (diff, comments, CI status, review threads)
- Normalize to DiffSet
- CLI: `diffprism review owner/repo#123`
- MCP: `open_pr_review()`

### M4: GitHub Integration — Write
- Post inline comments to GitHub
- Submit review (approve/changes) to GitHub
- Sync comment threads

### M5: AI-Powered Analysis
- Claude API for deep diff analysis
- Intent inference from agent reasoning + code context
- Convention detection from codebase patterns
- Risk assessment with explanations

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
