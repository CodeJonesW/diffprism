# @diffprism/ui

Browser-based React review UI. Standalone Vite app — not imported as a library. Connected to core via WebSocket.

## Stack

React 19, Vite 6, Tailwind CSS 3, Zustand 5, react-diff-view 3, refractor 4, Lucide React.

## Key Files

- `src/store/review.ts` — Zustand store. All review state lives here. Actions: `initReview`, `selectFile`, `setConnectionStatus`.
- `src/hooks/useWebSocket.ts` — Reads `wsPort` from URL query params, connects to WS, dispatches to store.
- `src/types.ts` — Local copy of core types (can't import workspace deps in Vite at runtime).
- `src/components/DiffViewer/DiffViewer.tsx` — Uses react-diff-view + refractor for syntax-highlighted unified diffs.
- `src/components/FileBrowser/FileBrowser.tsx` — File list sidebar with status badges.
- `src/components/ActionBar/ActionBar.tsx` — Approve/Request Changes buttons + summary textarea.

## Important Patterns

- **refractor v4 adapter:** `react-diff-view` expects the old refractor v2 API (`highlight()` returns array). The `refractorAdapter` in DiffViewer.tsx wraps v4's Root return to `.children`.
- **Per-file diff extraction:** `extractFileDiff()` splits the full rawDiff at `diff --git` boundaries to get the section for the selected file. This is needed because react-diff-view's `parseDiff` expects a single-file diff.
- **Types are duplicated** from core into `src/types.ts`. When you update core types, update these too.

## Theme

Dark mode only (M0). Colors defined in `tailwind.config.js`: background (#0d1117), surface (#161b22), border (#30363d), text-primary (#e6edf3), text-secondary (#8b949e), accent (#58a6ff).

## Dev Server

Started programmatically by the core pipeline via `createServer()` from Vite. URL query params: `wsPort` (WebSocket port), `reviewId` (session ID).
