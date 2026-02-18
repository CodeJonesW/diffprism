# @diffprism/git

Git diff extraction and unified diff parser. No runtime dependencies beyond Node.js built-ins.

## Key Files

- `src/local.ts` — `getGitDiff(ref)` shells out to `git diff` via `execSync`. Translates "staged"/"unstaged" to flags.
- `src/parser.ts` — `parseDiff(rawDiff, baseRef, headRef)` parses unified diff format into `DiffSet`.
- `src/index.ts` — `getDiff(ref)` combines both, returns `{ diffSet, rawDiff }`.

## Parser Details

The parser is a line-by-line state machine. Key behaviors:
- Detects file status from `---`/`+++` lines (/dev/null → added/deleted) and `rename from/to` headers
- Counts additions/deletions per file
- Detects language from file extension via a static map (defaults to "text")
- Skips `\ No newline at end of file` markers
- Handles binary files (marks as binary, no hunk parsing)

## Testing Tips

Create fixture `.diff` files with known content and assert `parseDiff()` output. The rawDiff string is the exact text you'd get from `git diff --no-color`.
