# @diffprism/analysis

Deterministic review briefing generator. No AI, no external deps. Pure functions.

## Key Files

- `src/deterministic.ts` — Six pure functions: `categorizeFiles`, `computeFileStats`, `detectAffectedModules`, `detectAffectedTests`, `detectNewDependencies`, `generateSummary`.
- `src/index.ts` — `analyze(diffSet)` composes all functions into a `ReviewBriefing`.

## M0 Simplifications

- `categorizeFiles` puts ALL files in "notable". Critical and mechanical buckets are empty.
- `verification` fields are all `null` (not run).
- `publicApiChanges` is `false`, `breakingChanges` is empty.
- No AI analysis — that's M5.

## Extension Points (Future)

- Add pattern matching (TODO/FIXME additions, console.log left in) to categorize files as "notable"
- Add complexity scoring based on line count / hunk count
- Add test coverage detection (changed code has corresponding test changes?)
- AI-powered analysis via Claude API (M5)
