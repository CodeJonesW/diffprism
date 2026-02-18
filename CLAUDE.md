# DiffPrism

Local-first code review tool for agent-generated code changes. Opens a browser-based diff viewer from CLI or Claude Code (via MCP).

## Architecture

pnpm monorepo with 6 packages + CLI:

```
packages/core     — Shared types, pipeline orchestrator, WebSocket bridge
packages/git      — Git diff extraction + unified diff parser
packages/analysis — Deterministic review briefing generation
packages/ui       — React 19 + Vite browser UI (diff viewer, file browser, action bar)
packages/mcp-server — MCP tool server (open_review)
packages/github   — Placeholder (M3+)
cli/              — Commander CLI entry point (review, serve commands)
```

**Dependency flow:** `git` + `analysis` → `core` (pipeline) → `cli` + `mcp-server`. UI is standalone Vite app connected via WebSocket.

## Key Commands

```bash
pnpm install                          # Install all deps
npx tsc --noEmit -p packages/X/tsconfig.json  # Type-check one package
pnpm cli review --staged              # Run CLI (via tsx)
```

## Conventions

- **All packages are ESM** (`"type": "module"`). Use `.js` extensions in relative imports.
- **Shared types** live in `packages/core/src/types.ts`. Other packages import with `import type { ... } from "@diffprism/core"`.
- **UI types** are duplicated in `packages/ui/src/types.ts` because Vite can't resolve workspace deps at runtime.
- **WebSocket protocol:** Server sends `review:init`, client sends `review:submit`. Messages defined in core types.
- **No inline line-level commenting yet** (M1). Comments are summary-only via textarea.
- **Dark mode only** for M0. GitHub dark theme colors.
- **Silent mode:** When `options.silent` is true, Vite logLevel is "silent" and no console output. Required for MCP (stdio corruption).

## Data Flow

1. `getDiff(ref)` → `{ diffSet, rawDiff }` (git package)
2. `analyze(diffSet)` → `ReviewBriefing` (analysis package)
3. Start WS bridge + Vite dev server on random ports
4. Open browser to `localhost:{vitePort}?wsPort={wsPort}&reviewId={id}`
5. WS sends `review:init` → UI renders diff
6. User clicks Approve/Request Changes → WS receives `review:submit`
7. Pipeline returns `ReviewResult`, cleans up servers

## File Naming

- React components: PascalCase in `ComponentName/ComponentName.tsx` with `index.ts` barrel
- Everything else: kebab-case filenames
- Exports: named exports, no default exports
