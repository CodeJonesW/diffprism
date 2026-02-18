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
